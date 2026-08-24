const db = require("../db");

const getRole = db.prepare("SELECT role FROM users WHERE id = ?");

// Runs after requireAuth (needs req.user.id already set). Queries the users
// table fresh on every request rather than trusting a role baked into the
// JWT at login time, so a role change takes effect without re-login.
function attachRole(req, res, next) {
  const row = getRole.get(req.user.id);
  if (!row) return res.status(401).json({ error: "Not authenticated" });
  req.user.role = row.role;
  next();
}

module.exports = attachRole;
