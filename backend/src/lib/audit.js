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

// IS (not =) so a NULL userId still matches correctly -- SQLite treats a
// bound parameter after IS as NULL-safe, unlike =.
const findRecent = db.prepare(`
  SELECT id, details FROM audit_log
  WHERE entity_type = ? AND entity_id = ? AND action = ? AND user_id IS ?
    AND created_at >= datetime('now', ?)
  ORDER BY created_at DESC
  LIMIT 1
`);

const touch = db.prepare(`UPDATE audit_log SET details = ?, created_at = datetime('now') WHERE id = ?`);

// Autosave writes to the DB every ~900ms of typing pause, and each of those
// saves used to log its own audit row -- filling out a multi-field header
// or a grid of measurements turned History into a wall of near-duplicate
// "Header updated" / "Measurements saved" entries seconds apart. These two
// fold a burst of same-action saves by the same user into the ONE most
// recent entry instead, as long as it's within COALESCE_WINDOW_MINUTES of
// the last one -- a new row only starts once that gap is exceeded, i.e. a
// genuinely new editing session.
const COALESCE_WINDOW_MINUTES = 5;

// changes: { field: { old, new } } -- each field's `old` is kept from the
// FIRST save in the session (not overwritten on later merges), so the
// merged row still reads as one true before -> after diff spanning the
// whole burst, not just the latest keystroke's tiny delta.
function recordHeaderAudit(entityType, entityId, userId, changes) {
  const recent = findRecent.get(entityType, entityId, "header_updated", userId ?? null, `-${COALESCE_WINDOW_MINUTES} minutes`);
  if (!recent) {
    recordAudit(entityType, entityId, "header_updated", userId, changes);
    return;
  }
  const previous = recent.details ? JSON.parse(recent.details) : {};
  const merged = { ...previous };
  Object.entries(changes).forEach(([field, change]) => {
    merged[field] = { old: previous[field] ? previous[field].old : change.old, new: change.new };
  });
  touch.run(JSON.stringify(merged), recent.id);
}

// changes: [{ balloon_number, sample_number, old_value, new_value }, ...] --
// merged by (balloon_number, sample_number) the same way, keeping each
// cell's original old_value from the first save and only updating new_value.
function recordMeasurementsAudit(entityType, entityId, userId, changes) {
  const recent = findRecent.get(entityType, entityId, "measurements_saved", userId ?? null, `-${COALESCE_WINDOW_MINUTES} minutes`);
  if (!recent) {
    recordAudit(entityType, entityId, "measurements_saved", userId, { changes });
    return;
  }
  const previous = recent.details ? JSON.parse(recent.details).changes || [] : [];
  const merged = [...previous];
  changes.forEach((change) => {
    const idx = merged.findIndex(
      (c) => c.balloon_number === change.balloon_number && c.sample_number === change.sample_number
    );
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], new_value: change.new_value };
    } else {
      merged.push(change);
    }
  });
  touch.run(JSON.stringify({ changes: merged }), recent.id);
}

module.exports = { recordAudit, recordHeaderAudit, recordMeasurementsAudit };
