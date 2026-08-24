const express = require("express");
const db = require("../db");
const { generateInspectionPdf } = require("../pdf/inspectionSheet");
const { recordAudit } = require("../lib/audit");
const { signInspectionStatus } = require("../lib/inspectionSigning");
const attachRole = require("../middleware/attachRole");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

const HEADER_FIELDS = [
  "customer",
  "heat",
  "quantity",
  "supplier",
  "po_number",
  "customer_po_number",
  "operation",
  "job_number",
  "inspector",
  "sampling_plan_n",
  "sampling_plan_c",
  "notes",
];

// Supports one-sided specs (max-only = "must not exceed", min-only = "must be at
// least") as well as two-sided tolerance bands. Returns null when neither bound
// is set, since there's nothing to check the measurement against.
function computeWithinTolerance(point, measuredValue) {
  if (!point || measuredValue == null) return null;
  // Points with no spec accept free text (e.g. "OK" on a Fixture check) --
  // never numerically comparable, so nothing to flag.
  if (typeof measuredValue !== "number" || Number.isNaN(measuredValue)) return null;
  const hasMax = point.max_spec != null;
  const hasMin = point.min_spec != null;
  if (!hasMax && !hasMin) return null;
  if (hasMax && measuredValue > point.max_spec) return 0;
  if (hasMin && measuredValue < point.min_spec) return 0;
  return 1;
}

// GET /api/inspections?part_id=1&type=final&client_id=1&status=approved&date_from=2026-01-01&date_to=2026-12-31&operation_id=1
router.get("/", (req, res) => {
  const { part_id, type, client_id, status, date_from, date_to, operation_id } = req.query;

  let query = `
    SELECT i.*, p.part_number, p.client_id, c.name AS client_name
    FROM inspections i
    JOIN parts p ON p.id = i.part_id
    JOIN clients c ON c.id = p.client_id
    WHERE 1 = 1
  `;
  const params = [];

  if (part_id) {
    query += " AND i.part_id = ?";
    params.push(part_id);
  }
  if (type) {
    query += " AND i.type = ?";
    params.push(type);
  }
  if (operation_id) {
    query += " AND i.operation_id = ?";
    params.push(operation_id);
  }
  if (client_id) {
    query += " AND p.client_id = ?";
    params.push(client_id);
  }
  // 'conditionally_approved' isn't a real i.status value (see PUT
  // /:id/status) -- it's status='approved' with a reason attached, so the
  // filter has to distinguish it from a plain approval by that instead.
  if (status === "conditionally_approved") {
    query += " AND i.status = 'approved' AND i.conditional_reason IS NOT NULL AND i.conditional_reason != ''";
  } else if (status === "approved") {
    query += " AND i.status = 'approved' AND (i.conditional_reason IS NULL OR i.conditional_reason = '')";
  } else if (status) {
    query += " AND i.status = ?";
    params.push(status);
  }
  if (date_from) {
    query += " AND i.date >= ?";
    params.push(date_from);
  }
  if (date_to) {
    query += " AND i.date <= ?";
    params.push(date_to + " 23:59:59");
  }
  query += " ORDER BY i.date DESC";

  res.json(db.prepare(query).all(...params));
});

// GET /api/inspections/status-lookup?part_number=...&job_number=...  (operator floor
// lookup: lightweight status info only, no measurements/full detail)
// Scoped to inspections created_by the logged-in user's id (a real FK match,
// not a free-text comparison against the inspector field) --
// deliberately scoped per-operator for now (an operator only sees their own work),
// can be loosened to company-wide visibility later if needed.
router.get("/status-lookup", attachRole, requireRole("operator", "qc", "admin"), (req, res) => {
  const { part_number, job_number } = req.query;
  if (!part_number) return res.status(400).json({ error: "part_number is required" });

  let query = `
    SELECT i.id, p.part_number, i.job_number, i.type, i.status, i.conditional_reason, i.date, i.inspector
    FROM inspections i
    JOIN parts p ON p.id = i.part_id
    WHERE LOWER(p.part_number) = LOWER(?) AND i.created_by = ?
  `;
  const params = [part_number, req.user.id];

  if (job_number) {
    query += " AND i.job_number = ?";
    params.push(job_number);
  }
  query += " ORDER BY i.date DESC";

  res.json(db.prepare(query).all(...params));
});

function getInspectionDetail(id) {
  const inspection = db
    .prepare(
      `SELECT i.*, p.part_number, p.description AS part_description, p.client_id,
              c.name AS client_name
       FROM inspections i
       JOIN parts p ON p.id = i.part_id
       JOIN clients c ON c.id = p.client_id
       WHERE i.id = ?`
    )
    .get(id);
  if (!inspection) return null;

  const measurements = db
    .prepare(
      `SELECT m.*, bp.balloon_number, bp.max_spec, bp.min_spec, bp.mean_value, bp.sort_order, bp.decimal_places
       FROM measurements m
       JOIN balloon_points bp ON bp.id = m.balloon_point_id
       WHERE m.inspection_id = ?
       ORDER BY bp.sort_order, m.sample_number`
    )
    .all(id);

  // All Find# columns defined on the drawing — independent of whether they
  // have a recorded measurement yet, so the sheet/PDF grid shows every
  // column from the start instead of only ones that already have data.
  const points = inspection.drawing_id
    ? db
        .prepare(
          `SELECT id, balloon_number, max_spec, min_spec, mean_value, decimal_places
           FROM balloon_points WHERE drawing_id = ? ORDER BY sort_order`
        )
        .all(inspection.drawing_id)
    : [];

  // The electronic signature that approved/rejected this Data Sheet, if it's
  // been signed — used by both the on-screen report and the PDF export.
  const signature = db
    .prepare(
      `SELECT s.action, s.signed_at, u.full_name
       FROM signatures s JOIN users u ON u.id = s.user_id
       WHERE s.inspection_id = ? ORDER BY s.signed_at DESC LIMIT 1`
    )
    .get(id);

  return { ...inspection, measurements, points, signature: signature || null };
}

// GET /api/inspections/:id  (includes measurements + specs for each balloon)
router.get("/:id", (req, res) => {
  const inspection = getInspectionDetail(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  res.json(inspection);
});

// GET /api/inspections/:id/audit  (chronological trail: audit_log + signatures, joined to users)
router.get("/:id/audit", (req, res) => {
  const entries = db
    .prepare(
      `SELECT a.id, a.action, a.details, a.created_at AS at, u.full_name AS user_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity_type = 'inspection' AND a.entity_id = ?
       UNION ALL
       SELECT s.id, ('signed_' || s.action) AS action, NULL AS details, s.signed_at AS at, u.full_name AS user_name
       FROM signatures s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.inspection_id = ?
       ORDER BY at ASC`
    )
    .all(req.params.id, req.params.id);

  res.json(
    entries.map((e) => ({ ...e, details: e.details ? JSON.parse(e.details) : null }))
  );
});

// POST /api/inspections  (creates the inspection; body: part_id or operation_id,
// drawing_id, type + optional header fields)
// Only one *open* (in_progress) Data Sheet per part+type at a time (scoped
// further by operation_id when set, so two different operations on the same
// part each get their own open in-process Data Sheet instead of resuming each
// other's): if one is already open it's resumed instead of creating a
// duplicate. Once a Data Sheet is signed (approved/rejected) it's locked
// history, and the next click starts a new one.
router.post("/", (req, res) => {
  const { drawing_id, type } = req.body;
  let { part_id, operation_id } = req.body;
  if (!type) return res.status(400).json({ error: "type is required" });

  if (operation_id) {
    // Never trust a client-supplied part_id when operation_id is set --
    // resolve it from the operation itself, so the two can't mismatch (same
    // pattern as POST /api/drawings).
    const operation = db.prepare("SELECT part_id FROM operations WHERE id = ?").get(operation_id);
    if (!operation) return res.status(404).json({ error: "Operation not found" });
    part_id = operation.part_id;
  } else if (!part_id) {
    return res.status(400).json({ error: "part_id is required (or operation_id)" });
  }

  const openExisting = operation_id
    ? db
        .prepare("SELECT * FROM inspections WHERE part_id = ? AND type = ? AND operation_id = ? AND status = 'in_progress'")
        .get(part_id, type, operation_id)
    : db
        .prepare("SELECT * FROM inspections WHERE part_id = ? AND type = ? AND operation_id IS NULL AND status = 'in_progress'")
        .get(part_id, type);
  if (openExisting) return res.json(openExisting);

  const part = db
    .prepare(`SELECT p.*, c.name AS client_name FROM parts p JOIN clients c ON c.id = p.client_id WHERE p.id = ?`)
    .get(part_id);
  if (!part) return res.status(404).json({ error: "Part not found" });

  const columns = ["part_id", "drawing_id", "type", "operation_id", "created_by", "updated_by", ...HEADER_FIELDS];
  const values = [
    part_id,
    drawing_id || null,
    type,
    operation_id || null,
    req.user.id,
    req.user.id,
    // "customer" defaults to the customer folder this part lives under —
    // still just a free-text field afterward, in case the paper form's
    // customer ever needs to differ from the client record (e.g. drop-ship).
    ...HEADER_FIELDS.map((f) => (f === "customer" ? req.body.customer ?? part.client_name : req.body[f] ?? null)),
  ];

  const result = db
    .prepare(
      `INSERT INTO inspections (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    )
    .run(...values);

  recordAudit("inspection", result.lastInsertRowid, "created", req.user.id, { type, part_id, operation_id: operation_id || null });

  const inspection = db.prepare("SELECT * FROM inspections WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(inspection);
});

// PUT /api/inspections/:id  (updates header fields: customer, heat, quantity, supplier,
// po_number, customer_po_number, operation, job_number, inspector, sampling plan,
// lot_disposition, notes, date)
router.put("/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM inspections WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Inspection not found" });
  if (existing.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }

  // "date" is the manually-entered inspection date (not a creation timestamp),
  // so it's editable here alongside the rest of the header — kept out of
  // HEADER_FIELDS since that list is also used by POST, where "date" should
  // never be forced to NULL just because the client didn't send one.
  const fields = [...HEADER_FIELDS, "date"];

  const changes = {};
  fields.forEach((f) => {
    if (req.body[f] !== undefined && req.body[f] !== existing[f]) {
      changes[f] = { old: existing[f], new: req.body[f] };
    }
  });

  const setClauses = fields.map((f) => `${f} = COALESCE(@${f}, ${f})`).join(", ");
  const values = { id: req.params.id, updated_by: req.user.id };
  fields.forEach((f) => {
    values[f] = req.body[f] ?? null;
  });

  db.prepare(`UPDATE inspections SET ${setClauses}, updated_by = @updated_by WHERE id = @id`).run(values);

  if (Object.keys(changes).length > 0) {
    recordAudit("inspection", req.params.id, "header_updated", req.user.id, changes);
  }

  res.json(db.prepare("SELECT * FROM inspections WHERE id = ?").get(req.params.id));
});

// PUT /api/inspections/:id/measurements  (saves/updates measurements in batch)
// body: { measurements: [{ balloon_point_id, sample_number, measured_value }, ...] }
router.put("/:id/measurements", (req, res) => {
  const inspection = db.prepare("SELECT status FROM inspections WHERE id = ?").get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (inspection.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }

  const { measurements } = req.body;
  if (!Array.isArray(measurements)) return res.status(400).json({ error: "measurements must be an array" });

  const getExisting = db.prepare(
    "SELECT measured_value FROM measurements WHERE inspection_id = ? AND balloon_point_id = ? AND sample_number = ?"
  );

  const upsert = db.prepare(`
    INSERT INTO measurements (inspection_id, balloon_point_id, sample_number, measured_value, within_tolerance)
    VALUES (@inspection_id, @balloon_point_id, @sample_number, @measured_value, @within_tolerance)
    ON CONFLICT(inspection_id, balloon_point_id, sample_number)
    DO UPDATE SET measured_value = excluded.measured_value, within_tolerance = excluded.within_tolerance
  `);

  const getPoint = db.prepare("SELECT * FROM balloon_points WHERE id = ?");

  const changes = [];

  const tx = db.transaction((items) => {
    for (const item of items) {
      const point = getPoint.get(item.balloon_point_id);
      const sampleNumber = item.sample_number ?? 1;
      const withinTolerance = computeWithinTolerance(point, item.measured_value);

      const existing = getExisting.get(req.params.id, item.balloon_point_id, sampleNumber);
      if (!existing || existing.measured_value !== item.measured_value) {
        changes.push({
          balloon_number: point?.balloon_number,
          sample_number: sampleNumber,
          old_value: existing?.measured_value ?? null,
          new_value: item.measured_value,
        });
      }

      upsert.run({
        inspection_id: req.params.id,
        balloon_point_id: item.balloon_point_id,
        sample_number: sampleNumber,
        measured_value: item.measured_value,
        within_tolerance: withinTolerance,
      });
    }
  });

  tx(measurements);

  if (changes.length > 0) {
    recordAudit("inspection", req.params.id, "measurements_saved", req.user.id, { changes });
  }

  const updated = db
    .prepare(
      `SELECT m.*, bp.balloon_number FROM measurements m
       JOIN balloon_points bp ON bp.id = m.balloon_point_id
       WHERE m.inspection_id = ? ORDER BY bp.balloon_number, m.sample_number`
    )
    .all(req.params.id);

  res.json(updated);
});

// DELETE /api/inspections/:id/measurements/:sampleNumber  (removes one sample row)
router.delete("/:id/measurements/:sampleNumber", (req, res) => {
  const inspection = db.prepare("SELECT status FROM inspections WHERE id = ?").get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (inspection.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }

  db.prepare("DELETE FROM measurements WHERE inspection_id = ? AND sample_number = ?").run(
    req.params.id,
    Number(req.params.sampleNumber)
  );

  recordAudit("inspection", req.params.id, "sample_deleted", req.user.id, {
    sample_number: req.params.sampleNumber,
  });

  res.status(204).send();
});

// PUT /api/inspections/:id/status  (approve/reject, requires an electronic-signature confirmation)
// body: { status: 'approved' | 'conditionally_approved' | 'rejected', signer_name: string, reason?: string }
// 'conditionally_approved' is a UI-facing result only -- signatures.action and
// inspections.status have no such value (both stay a plain 'approved' CHECK
// enum), so it's stored as status='approved' plus a required conditional_reason.
router.put("/:id/status", attachRole, requireRole("qc", "admin"), (req, res) => {
  const { status, signer_name, reason } = req.body;
  if (!["approved", "conditionally_approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be 'approved', 'conditionally_approved', or 'rejected'" });
  }
  if (status === "conditionally_approved" && !reason?.trim()) {
    return res.status(400).json({ error: "reason is required to conditionally approve this Data Sheet" });
  }

  const existing = db.prepare("SELECT status, inspector FROM inspections WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Inspection not found" });
  if (existing.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has already been signed." });
  }

  if (!existing.inspector || !existing.inspector.trim()) {
    return res.status(400).json({
      error: "Set and save the inspector name (By) before approving or rejecting this Data Sheet.",
    });
  }

  if (!signer_name || signer_name.trim().toLowerCase() !== req.user.full_name.trim().toLowerCase()) {
    return res.status(400).json({ error: "signer_name must match your logged-in full name to sign" });
  }

  const dbStatus = status === "conditionally_approved" ? "approved" : status;
  const conditionalReason = status === "conditionally_approved" ? reason.trim() : null;

  signInspectionStatus(db, { inspectionId: req.params.id, userId: req.user.id, status: dbStatus, conditionalReason });
  recordAudit("inspection", req.params.id, "status_changed", req.user.id, { status, reason: conditionalReason });

  const inspection = db.prepare("SELECT * FROM inspections WHERE id = ?").get(req.params.id);
  res.json(inspection);
});

// DELETE /api/inspections/:id  (cascades to its measurements and signatures)
router.delete("/:id", attachRole, requireRole("qc", "admin"), (req, res) => {
  const result = db.prepare("DELETE FROM inspections WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Inspection not found" });
  res.status(204).send();
});

// GET /api/inspections/:id/pdf  (renders the Data Sheet as a downloadable PDF)
router.get("/:id/pdf", (req, res) => {
  const inspection = getInspectionDetail(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="inspection-${inspection.id}.pdf"`);
  generateInspectionPdf(res, inspection);
});

module.exports = router;
