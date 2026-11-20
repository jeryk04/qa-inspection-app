const db = require("../db");

// A user has one main role (users.role) plus any number of additional ones
// (user_roles) and gets the combined permissions of all of them -- e.g. an
// Operator who also does QC work. Route guards check the whole set
// (requireRole / hasRole); `role` alone is the highest of the set, which
// keeps the many "role === 'operator'" restrictions (customer assignments,
// Operator In-Process only) applying only to someone who is nothing but an
// Operator. The Home screen / app experience follows `main_role` instead
// (see the frontend's AuthContext effectiveRole) -- e.g. an Operator who's
// also a Supervisor still gets the Operator screens, with the Supervisor's
// extra permissions on top.
const ROLE_PRIORITY = ["admin", "qa_manager", "supervisor", "qc", "engineer", "operator"];
const ALL_ROLES = [...ROLE_PRIORITY];

const getMainRole = db.prepare("SELECT role FROM users WHERE id = ?");
const getExtraRoles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?");

function topRole(roles) {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) || roles[0] || null;
}

// { role: highest, roles: every role, main_role } -- null if no such user.
function loadRoles(userId) {
  const row = getMainRole.get(userId);
  if (!row) return null;
  const roles = [...new Set([row.role, ...getExtraRoles.all(userId).map((r) => r.role)])];
  return { role: topRole(roles), roles, main_role: row.role };
}

function hasRole(user, ...allowed) {
  const roles = user?.roles || (user?.role ? [user.role] : []);
  return roles.some((r) => allowed.includes(r));
}

module.exports = { ALL_ROLES, ROLE_PRIORITY, topRole, loadRoles, hasRole };
