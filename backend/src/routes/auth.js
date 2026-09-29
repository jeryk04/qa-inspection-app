const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { signToken, verifyToken, COOKIE_NAME } = require("../lib/jwt");
const { PIN_LENGTH, isValidPin } = require("../lib/pin");
const { isValidEmail } = require("../lib/email");

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: 12 * 60 * 60 * 1000,
};

// POST /api/auth/login  { username, password }
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: "username is required" });

  const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username);
  if (!user) return res.status(401).json({ error: "Invalid username or password" });

  // Every role -- Operator through Admin -- signs in with a PIN. There's no
  // passwordless path anymore: Operators used to skip this check entirely,
  // but that's gone now that every account carries a real credential.
  if (!password || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    must_change_password: !!user.must_change_password,
  });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax" });
  res.status(204).send();
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const payload = verifyToken(token);
    // role isn't in the JWT (it's not embedded at login, see attachRole.js for
    // why) -- look it up fresh so a role change is reflected without re-login.
    const user = db
      .prepare("SELECT id, username, full_name, role, must_change_password, email FROM users WHERE id = ?")
      .get(payload.sub);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    res.json({ ...user, must_change_password: !!user.must_change_password });
  } catch {
    res.status(401).json({ error: "Not authenticated" });
  }
});

// PUT /api/auth/password  { current_password, new_password } -- self-service
// change, available to any logged-in user (not just must_change_password
// accounts) so people can rotate their own password whenever they want, not
// only on the forced first-login prompt.
router.put("/password", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "current_password and new_password are required" });
  }
  if (!isValidPin(new_password)) {
    return res.status(400).json({ error: `New PIN must be exactly ${PIN_LENGTH} digits` });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const password_hash = bcrypt.hashSync(new_password, 10);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(password_hash, user.id);
  res.status(204).send();
});

// PUT /api/auth/email  { email } -- self-service, like PUT /password above.
// email is optional (a user may not have one): pass "" or null to clear it.
router.put("/email", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const email = req.body.email?.trim() || null;
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: "That doesn't look like a valid email address." });
  }

  db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, payload.sub);
  res.json({ email });
});

module.exports = router;
