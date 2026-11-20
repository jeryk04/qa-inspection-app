const db = require("../db");

// Whether an Operator/Supervisor is allowed to work with this customer's data --
// checked against user_clients (see schema.sql), the same admin-managed
// assignment set/edited on the Admin > Users screen ("Assigned customers").
// Only enforced for isCustomerRestricted users (below).
function isAssignedToClient(userId, clientId) {
  return !!db
    .prepare("SELECT 1 FROM user_clients WHERE user_id = ? AND client_id = ?")
    .get(userId, clientId);
}

// Who the customer assignment above actually restricts: Operators and
// Supervisors -- anyone whose roles are only those two (e.g. an Operator
// who's also a Supervisor). Holding any other role (QC, Engineer, QA
// Manager, Admin) means seeing every customer, as before.
const CUSTOMER_RESTRICTED_ROLES = ["operator", "supervisor"];
function isCustomerRestricted(user) {
  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  return roles.length > 0 && roles.every((r) => CUSTOMER_RESTRICTED_ROLES.includes(r));
}

module.exports = { isAssignedToClient, isCustomerRestricted };
