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
  if (!username || !password) return res.status(400).json({ error: "username and password are required" });

  const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({ id: user.id, username: user.username, full_name: user.full_name, role: user.role });
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
    const user = db.prepare("SELECT id, username, full_name, role FROM users WHERE id = ?").get(payload.sub);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    res.json(user);
  } catch {
    res.status(401).json({ error: "Not authenticated" });
  }
});

module.exports = router;
