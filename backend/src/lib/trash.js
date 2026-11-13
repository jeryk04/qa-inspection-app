// Admin recycle bin -- captures everything under an Operation (see DELETE
// /api/parts/:partId/operations/:id) or a single Data Sheet (DELETE
// /api/inspections/:id) into one JSON snapshot before its cascading delete,
// and can rebuild it later from that snapshot. Another entity_type can be
// added by adding an archive*/restore* pair here and a case in
// restoreEntity below, without changing the deleted_items table shape.

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
  const sampleRows = forInspections("inspection_sample_rows");
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

  const snapshot = {
    operation,
    drawings,
    points,
    inspections,
    measurements,
    pointSummaries,
    sampleRows,
    signatures,
    auditLog,
  };

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
  const { operation, drawings, points, inspections, measurements, pointSummaries, sampleRows, signatures, auditLog } =
    snapshot;

  // scope was added after some existing deleted_items snapshots were
  // captured (see schema.sql/db.js) -- those pre-migration snapshots have
  // no scope key at all, so fall back to 'setup' (the same default every
  // pre-existing operation was migrated to).
  db.prepare(
    "INSERT INTO operations (id, part_id, name, scope, created_at) VALUES (@id, @part_id, @name, @scope, @created_at)"
  ).run({ ...operation, scope: operation.scope ?? "setup" });

  const insertDrawing = db.prepare(`
    INSERT INTO balloon_drawings
      (id, part_id, image_path, version, revision_label, operation_id, hundred_percent_inspection, machine_log_mode,
       reinspect_interval_minutes, created_at)
    VALUES (@id, @part_id, @image_path, @version, @revision_label, @operation_id, @hundred_percent_inspection, @machine_log_mode,
       @reinspect_interval_minutes, @created_at)
  `);
  // machine_log_mode didn't exist when some older snapshots were captured --
  // same fallback as is_check_column above: a pre-migration drawing was
  // never in that mode, so 0 (off) is always correct, not inferred. Same
  // for reinspect_interval_minutes (NULL = no reminder).
  drawings.forEach((d) =>
    insertDrawing.run({
      ...d,
      machine_log_mode: d.machine_log_mode ?? 0,
      reinspect_interval_minutes: d.reinspect_interval_minutes ?? null,
    })
  );

  const insertPoint = db.prepare(`
    INSERT INTO balloon_points
      (id, drawing_id, balloon_number, max_spec, min_spec, mean_value, sort_order, decimal_places, is_check_column, is_reference,
       retired_at)
    VALUES (@id, @drawing_id, @balloon_number, @max_spec, @min_spec, @mean_value, @sort_order, @decimal_places, @is_check_column, @is_reference,
            @retired_at)
  `);
  points.forEach((p) =>
    insertPoint.run({
      ...p,
      // is_check_column didn't exist when some older snapshots were captured
      // (same situation as operation.scope above) -- fall back to the same
      // rule db.js's migration backfilled every already-existing point with:
      // infer it from all-blank specs.
      is_check_column: p.is_check_column ?? (p.max_spec == null && p.min_spec == null && p.mean_value == null ? 1 : 0),
      // Older snapshots predate is_reference; nothing was a reference then.
      is_reference: p.is_reference ?? 0,
      // Older snapshots predate retired_at; nothing was retired then.
      retired_at: p.retired_at ?? null,
    })
  );

  const insertInspection = db.prepare(`
    INSERT INTO inspections
      (id, part_id, drawing_id, type, inspector, date, status, notes, customer, heat, quantity, supplier,
       po_number, customer_po_number, operation, operation_id, job_number, sampling_plan_n, sampling_plan_c,
       lot_disposition, conditional_reason, requires_in_process, hundred_percent_inspection, machine_log_mode,
       created_by, updated_by)
    VALUES
      (@id, @part_id, @drawing_id, @type, @inspector, @date, @status, @notes, @customer, @heat, @quantity, @supplier,
       @po_number, @customer_po_number, @operation, @operation_id, @job_number, @sampling_plan_n, @sampling_plan_c,
       @lot_disposition, @conditional_reason, @requires_in_process, @hundred_percent_inspection, @machine_log_mode,
       @created_by, @updated_by)
  `);
  // Same machine_log_mode fallback as balloon_drawings above.
  inspections.forEach((i) => insertInspection.run({ ...i, machine_log_mode: i.machine_log_mode ?? 0 }));

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

  // sampleRows didn't exist when some older snapshots were captured -- falls
  // back to an empty array, same reasoning as the column-level fallbacks
  // above (a pre-migration inspection was never in machine_log_mode, so it
  // never had any of these rows to begin with).
  const insertSampleRow = db.prepare(`
    INSERT INTO inspection_sample_rows (id, inspection_id, sample_number, qty, machine_number, comment)
    VALUES (@id, @inspection_id, @sample_number, @qty, @machine_number, @comment)
  `);
  (sampleRows || []).forEach((r) => insertSampleRow.run(r));

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

// Every table whose rows belong to one inspection and go with it when it's
// deleted (ON DELETE CASCADE in schema.sql). audit_log isn't here: it has no
// FK, so a deleted inspection's history stays in place and needs no restore.
const INSPECTION_CHILD_TABLES = [
  "measurements",
  "inspection_point_summaries",
  "inspection_sample_rows",
  "inspection_photos",
  "inspection_certs",
  "signatures",
  "inspection_required_operations",
];

// Inserts a snapshot row with its original id, using only the columns the
// table has now -- so a snapshot taken before a later column was added (or
// after one was dropped) still restores, with the new column at its default.
function insertSnapshotRow(db, table, row) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name)
    .filter((c) => c in row);
  db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`).run(
    Object.fromEntries(columns.map((c) => [c, row[c]]))
  );
}

// One Data Sheet deleted from History / a Data Sheets list (DELETE
// /api/inspections/:id): the inspection row plus everything that cascades
// with it. Must run in the same transaction as the delete.
function archiveInspection(db, inspectionId, label, userId) {
  const inspection = db.prepare("SELECT * FROM inspections WHERE id = ?").get(inspectionId);
  if (!inspection) return;
  const children = Object.fromEntries(
    INSPECTION_CHILD_TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} WHERE inspection_id = ?`).all(inspectionId)])
  );
  insertTrash(db).run({
    entity_type: "inspection",
    entity_id: inspectionId,
    label,
    snapshot: JSON.stringify({ inspection, children }),
    deleted_by: userId ?? null,
  });
}

// Puts the Data Sheet back with its original id. Refuses (rather than half-
// restoring) when something it points at has since been deleted too -- its
// part, operation, template revision, or a Find# column it has readings in.
function restoreInspection(db, { inspection, children }, userId) {
  // status 409: the admin route shows these messages as-is.
  const cannotRestore = (message) => Object.assign(new Error(message), { status: 409 });
  const missing = (sql, id) => id != null && !db.prepare(sql).get(id);
  if (missing("SELECT 1 FROM parts WHERE id = ?", inspection.part_id)) {
    throw cannotRestore("Its part has been deleted, so this Data Sheet can't be restored.");
  }
  if (missing("SELECT 1 FROM operations WHERE id = ?", inspection.operation_id)) {
    throw cannotRestore("Its operation has been deleted — restore the operation first.");
  }
  if (missing("SELECT 1 FROM balloon_drawings WHERE id = ?", inspection.drawing_id)) {
    throw cannotRestore("The template revision it was recorded on has been deleted, so it can't be restored.");
  }
  const pointIds = [
    ...new Set(
      [...(children.measurements || []), ...(children.inspection_point_summaries || [])].map((r) => r.balloon_point_id)
    ),
  ];
  if (pointIds.some((id) => missing("SELECT 1 FROM balloon_points WHERE id = ?", id))) {
    throw cannotRestore("A Find# column it has readings in has been deleted, so it can't be restored.");
  }
  if (db.prepare("SELECT 1 FROM inspections WHERE id = ?").get(inspection.id)) {
    throw cannotRestore("This Data Sheet already exists.");
  }

  insertSnapshotRow(db, "inspections", inspection);
  for (const table of INSPECTION_CHILD_TABLES) {
    for (const row of children[table] || []) {
      // A required Operator operation deleted since just drops off the
      // Final's list, rather than blocking the whole restore.
      if (table === "inspection_required_operations" && missing("SELECT 1 FROM operations WHERE id = ?", row.operation_id)) {
        continue;
      }
      insertSnapshotRow(db, table, row);
    }
  }
  // Its earlier history (incl. the 'deleted' entry) never left audit_log;
  // this closes that story on the sheet's History.
  db.prepare(
    "INSERT INTO audit_log (entity_type, entity_id, action, user_id, details) VALUES ('inspection', ?, 'restored', ?, NULL)"
  ).run(inspection.id, userId ?? null);
}

const RESTORERS = { operation: restoreOperation, inspection: restoreInspection };

// Dispatches a deleted_items row to its entity_type's restorer, then marks
// the row restored. Must run inside a transaction alongside the caller's
// read of the trash row, same atomicity reasoning as archiveOperation.
function restoreEntity(db, trashRow, userId) {
  const restorer = RESTORERS[trashRow.entity_type];
  if (!restorer) throw new Error(`No restorer for entity_type "${trashRow.entity_type}"`);
  restorer(db, JSON.parse(trashRow.snapshot), userId);
  db.prepare("UPDATE deleted_items SET restored_by = ?, restored_at = datetime('now') WHERE id = ?").run(
    userId ?? null,
    trashRow.id
  );
}

module.exports = { archiveOperation, archiveInspection, restoreEntity };
