const { loadRoles } = require("../lib/roles");

// Runs after requireAuth (needs req.user.id already set). Queries the users
// table fresh on every request rather than trusting a role baked into the
// JWT at login time, so a role change takes effect without re-login.
// req.user.roles is every role the user holds (main + additional, see
// lib/roles.js); req.user.role is the highest of them.
function attachRole(req, res, next) {
  const loaded = loadRoles(req.user.id);
  if (!loaded) return res.status(401).json({ error: "Not authenticated" });
  req.user.role = loaded.role;
  req.user.roles = loaded.roles;
  next();
}

module.exports = attachRole;
