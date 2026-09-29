const db = require("../db");

// Whether an Operator is allowed to work with this customer's data --
// checked against user_clients (see schema.sql), the same admin-managed
// assignment set/edited on the Admin > Users screen ("Assigned customers").
// Irrelevant for every other role, which is unrestricted by customer.
function isAssignedToClient(userId, clientId) {
  return !!db
    .prepare("SELECT 1 FROM user_clients WHERE user_id = ? AND client_id = ?")
    .get(userId, clientId);
}

module.exports = { isAssignedToClient };
