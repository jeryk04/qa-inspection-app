const { hasRole } = require("../lib/roles");

// Must run after attachRole (needs req.user.roles already set). Passes if
// ANY of the user's roles is allowed -- a user with two roles gets both
// roles' permissions (see lib/roles.js).
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!hasRole(req.user, ...allowedRoles)) {
      console.warn("[TEMP-DEBUG 403]", req.method, req.originalUrl, "user:", req.user?.id, req.user?.username, "role:", req.user?.role, "allowed:", allowedRoles);
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

module.exports = requireRole;
