const db = require("../db");

const insert = db.prepare(`
  INSERT INTO audit_log (entity_type, entity_id, action, user_id, details)
  VALUES (@entity_type, @entity_id, @action, @user_id, @details)
`);

function recordAudit(entityType, entityId, action, userId, details) {
  insert.run({
    entity_type: entityType,
    entity_id: entityId,
    action,
    user_id: userId ?? null,
    details: details != null ? JSON.stringify(details) : null,
  });
}

module.exports = { recordAudit };
