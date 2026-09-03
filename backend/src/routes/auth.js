const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { signToken, verifyToken, COOKIE_NAME } = require("../lib/jwt");

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

  // Operators sign in with just their numeric employee code -- a quick
  // tap-in at a shared shop-floor tablet, no password at all. Every other
  // role still needs a real password: QC/Engineer/Admin can approve or
  // reject Data Sheets, delete records, or manage other users, so those
  // stay behind a real credential.
  if (user.role !== "operator") {
    if (!password || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
  }

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    // Password management is moot for a role that doesn't use a password to
    // sign in -- never force an Operator through the change-password gate,
    // regardless of their stored flag (it stays as-is in the DB in case
    // they're later promoted to a role that does need a real password).
    must_change_password: user.role === "operator" ? false : !!user.must_change_password,
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
      .prepare("SELECT id, username, full_name, role, must_change_password FROM users WHERE id = ?")
      .get(payload.sub);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    res.json({ ...user, must_change_password: user.role === "operator" ? false : !!user.must_change_password });
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
  if (new_password.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const password_hash = bcrypt.hashSync(new_password, 10);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(password_hash, user.id);
  res.status(204).send();
});

module.exports = router;
