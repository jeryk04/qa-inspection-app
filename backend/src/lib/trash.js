// Admin recycle bin -- captures everything under an Operation into one JSON
// snapshot before its cascading delete (see DELETE /api/parts/:partId/
// operations/:id), and can rebuild it all later from that snapshot. Only
// 'operation' is implemented; another entity_type can be added later by
// adding an archive*/restore* pair here and a case in restoreEntity below,
// without changing the deleted_items table shape.

const insertTrash = (db) =>
  db.prepare(`
    INSERT INTO deleted_items (entity_type, entity_id, label, snapshot, deleted_by)
    VALUES (@entity_type, @entity_id, @label, @snapshot, @deleted_by)
  `);

// Loads an operation's full subtree (Data Sheet Template + inspection
// history) and records it as one deleted_items row. Must run inside the
// same transaction as the deletes that follow it, so the snapshot and the
// removal are atomic.
function archiveOperation(db, operation, part, userId) {
  const drawings = db.prepare("SELECT * FROM balloon_drawings WHERE operation_id = ?").all(operation.id);
  const points = drawings.flatMap((d) =>
    db.prepare("SELECT * FROM balloon_points WHERE drawing_id = ?").all(d.id)
  );

  const inspections = db.prepare("SELECT * FROM inspections WHERE operation_id = ?").all(operation.id);
  const inspectionIds = inspections.map((i) => i.id);
  const forInspections = (table) =>
    inspectionIds.length === 0
      ? []
      : db
          .prepare(`SELECT * FROM ${table} WHERE inspection_id IN (${inspectionIds.map(() => "?").join(",")})`)
          .all(...inspectionIds);

  const measurements = forInspections("measurements");
  const pointSummaries = forInspections("inspection_point_summaries");
  const signatures = forInspections("signatures");
  const auditLog =
    inspectionIds.length === 0
      ? []
      : db
          .prepare(
            `SELECT * FROM audit_log WHERE entity_type = 'inspection' AND entity_id IN (${inspectionIds
              .map(() => "?")
              .join(",")})`
          )
          .all(...inspectionIds);

  const snapshot = { operation, drawings, points, inspections, measurements, pointSummaries, signatures, auditLog };

  insertTrash(db).run({
    entity_type: "operation",
    entity_id: operation.id,
    label: `${operation.name} — ${part.part_number}`,
    snapshot: JSON.stringify(snapshot),
    deleted_by: userId ?? null,
  });
}

// Re-inserts every row from an archiveOperation snapshot with its original
// id. Explicit-id inserts are fine under AUTOINCREMENT as long as the id
// isn't currently taken -- true here since the whole subtree was deleted
// together and nothing outside it referenced those ids.
function restoreOperation(db, snapshot) {
  const { operation, drawings, points, inspections, measurements, pointSummaries, signatures, auditLog } = snapshot;

  // scope was added after some existing deleted_items snapshots were
  // captured (see schema.sql/db.js) -- those pre-migration snapshots have
  // no scope key at all, so fall back to 'setup' (the same default every
  // pre-existing operation was migrated to).
  db.prepare(
    "INSERT INTO operations (id, part_id, name, scope, created_at) VALUES (@id, @part_id, @name, @scope, @created_at)"
  ).run({ ...operation, scope: operation.scope ?? "setup" });

  const insertDrawing = db.prepare(`
    INSERT INTO balloon_drawings
      (id, part_id, image_path, version, revision_label, operation_id, hundred_percent_inspection, created_at)
    VALUES (@id, @part_id, @image_path, @version, @revision_label, @operation_id, @hundred_percent_inspection, @created_at)
  `);
  drawings.forEach((d) => insertDrawing.run(d));

  const insertPoint = db.prepare(`
    INSERT INTO balloon_points
      (id, drawing_id, balloon_number, max_spec, min_spec, mean_value, sort_order, decimal_places)
    VALUES (@id, @drawing_id, @balloon_number, @max_spec, @min_spec, @mean_value, @sort_order, @decimal_places)
  `);
  points.forEach((p) => insertPoint.run(p));

  const insertInspection = db.prepare(`
    INSERT INTO inspections
      (id, part_id, drawing_id, type, inspector, date, status, notes, customer, heat, quantity, supplier,
       po_number, customer_po_number, operation, operation_id, job_number, sampling_plan_n, sampling_plan_c,
       lot_disposition, conditional_reason, requires_in_process, hundred_percent_inspection, created_by, updated_by)
    VALUES
      (@id, @part_id, @drawing_id, @type, @inspector, @date, @status, @notes, @customer, @heat, @quantity, @supplier,
       @po_number, @customer_po_number, @operation, @operation_id, @job_number, @sampling_plan_n, @sampling_plan_c,
       @lot_disposition, @conditional_reason, @requires_in_process, @hundred_percent_inspection, @created_by, @updated_by)
  `);
  inspections.forEach((i) => insertInspection.run(i));

  const insertMeasurement = db.prepare(`
    INSERT INTO measurements (id, inspection_id, balloon_point_id, sample_number, measured_value, within_tolerance)
    VALUES (@id, @inspection_id, @balloon_point_id, @sample_number, @measured_value, @within_tolerance)
  `);
  measurements.forEach((m) => insertMeasurement.run(m));

  const insertPointSummary = db.prepare(`
    INSERT INTO inspection_point_summaries
      (id, inspection_id, balloon_point_id, qty_inspected, qty_rejected, reject_notes)
    VALUES (@id, @inspection_id, @balloon_point_id, @qty_inspected, @qty_rejected, @reject_notes)
  `);
  pointSummaries.forEach((s) => insertPointSummary.run(s));

  const insertSignature = db.prepare(`
    INSERT INTO signatures (id, inspection_id, user_id, action, signed_at)
    VALUES (@id, @inspection_id, @user_id, @action, @signed_at)
  `);
  signatures.forEach((s) => insertSignature.run(s));

  const insertAudit = db.prepare(`
    INSERT INTO audit_log (id, entity_type, entity_id, action, user_id, details, created_at)
    VALUES (@id, @entity_type, @entity_id, @action, @user_id, @details, @created_at)
  `);
  auditLog.forEach((a) => insertAudit.run(a));
}

const RESTORERS = { operation: restoreOperation };

// Dispatches a deleted_items row to its entity_type's restorer, then marks
// the row restored. Must run inside a transaction alongside the caller's
// read of the trash row, same atomicity reasoning as archiveOperation.
function restoreEntity(db, trashRow, userId) {
  const restorer = RESTORERS[trashRow.entity_type];
  if (!restorer) throw new Error(`No restorer for entity_type "${trashRow.entity_type}"`);
  restorer(db, JSON.parse(trashRow.snapshot));
  db.prepare("UPDATE deleted_items SET restored_by = ?, restored_at = datetime('now') WHERE id = ?").run(
    userId ?? null,
    trashRow.id
  );
}

module.exports = { archiveOperation, restoreEntity };
