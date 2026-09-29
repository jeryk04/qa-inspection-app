const express = require("express");
const multer = require("multer");
const path = require("path");
const db = require("../db");
const attachRole = require("../middleware/attachRole");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, "..", "..", "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `drawing-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

function clampDecimalPlaces(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(6, Math.max(0, Math.round(n)));
}

// GET /api/drawings?part_id=1  (Final Inspection drawings for a part) or
// GET /api/drawings?operation_id=1  (template revisions for one operation) --
// operation_id IS NULL is what marks a row as the Final Inspection bucket
// (see idx_final_drawing_version / idx_operation_template_version), so
// part_id alone must exclude operation-linked rows to keep matching that.
router.get("/", (req, res) => {
  const { part_id, operation_id } = req.query;
  let drawings;
  if (operation_id) {
    drawings = db
      .prepare("SELECT * FROM balloon_drawings WHERE operation_id = ? ORDER BY version DESC")
      .all(operation_id);
  } else if (part_id) {
    drawings = db
      .prepare("SELECT * FROM balloon_drawings WHERE part_id = ? AND operation_id IS NULL ORDER BY version DESC")
      .all(part_id);
  } else {
    drawings = db.prepare("SELECT * FROM balloon_drawings ORDER BY created_at DESC").all();
  }
  res.json(drawings);
});

// GET /api/drawings/:id  (includes its points)
router.get("/:id", (req, res) => {
  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(req.params.id);
  if (!drawing) return res.status(404).json({ error: "Drawing not found" });

  const points = db
    .prepare("SELECT * FROM balloon_points WHERE drawing_id = ? ORDER BY sort_order")
    .all(req.params.id);

  res.json({ ...drawing, points });
});

// GET /api/drawings/:id/analytics -- every measurement ever recorded
// against this specific drawing revision, grouped per Find#, for the
// "Measurement History" section on DataSheetTemplate.jsx. Scoped to this
// one drawing_id (the current template revision the caller already has
// loaded), not every historical revision of the part/operation's template.
router.get("/:id/analytics", (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.balloon_point_id, m.measured_value, m.within_tolerance, m.sample_number,
              i.id AS inspection_id, i.date, i.job_number
       FROM measurements m
       JOIN inspections i ON i.id = m.inspection_id
       WHERE m.inspection_id IN (SELECT id FROM inspections WHERE drawing_id = ?)
       ORDER BY i.date ASC`
    )
    .all(req.params.id);

  const points = {};
  const batchesByPoint = {};
  rows.forEach((r) => {
    if (!points[r.balloon_point_id]) points[r.balloon_point_id] = { totalRows: 0, filledRows: 0, readings: [] };
    const p = points[r.balloon_point_id];
    p.totalRows += 1;
    if (r.measured_value != null) {
      p.filledRows += 1;
      p.readings.push({ value: r.measured_value, date: r.date, within_tolerance: r.within_tolerance });

      if (!batchesByPoint[r.balloon_point_id]) batchesByPoint[r.balloon_point_id] = new Map();
      const batches = batchesByPoint[r.balloon_point_id];
      if (!batches.has(r.inspection_id)) {
        batches.set(r.inspection_id, {
          inspection_id: r.inspection_id,
          job_number: r.job_number || "WO# —",
          date: r.date,
          samples: [],
        });
      }
      batches.get(r.inspection_id).samples.push({
        sample_number: r.sample_number,
        value: r.measured_value,
        within_tolerance: r.within_tolerance,
      });
    }
  });

  Object.entries(points).forEach(([pointId, p]) => {
    p.batches = batchesByPoint[pointId] ? Array.from(batchesByPoint[pointId].values()) : [];
  });

  res.json({ points });
});

const getPriorFinalDrawing = db.prepare(
  "SELECT * FROM balloon_drawings WHERE part_id = ? AND operation_id IS NULL ORDER BY version DESC LIMIT 1"
);
const getPriorOperationDrawing = db.prepare(
  "SELECT * FROM balloon_drawings WHERE operation_id = ? ORDER BY version DESC LIMIT 1"
);
const insertDrawing = db.prepare(
  "INSERT INTO balloon_drawings (part_id, image_path, version, revision_label, operation_id) VALUES (?, ?, ?, ?, ?)"
);
const getPointsForDrawing = db.prepare("SELECT * FROM balloon_points WHERE drawing_id = ? ORDER BY sort_order");
const insertPoint = db.prepare(`
  INSERT INTO balloon_points
    (drawing_id, balloon_number, max_spec, min_spec, mean_value, sort_order, decimal_places, is_check_column, is_reference)
  VALUES (@drawing_id, @balloon_number, @max_spec, @min_spec, @mean_value, @sort_order, @decimal_places, @is_check_column, @is_reference)
`);

// POST /api/drawings  (multipart/form-data: part_id or operation_id required,
// image optional; image/PDF both accepted). A drawing revision can exist
// without an image — e.g. so its Find# columns/specs can be set up before a
// drawing is ready to upload.
//
// operation_id NULL vs set puts the row in one of two separate version
// sequences (see idx_final_drawing_version / idx_operation_template_version):
// Final Inspection drawings auto-increment per part_id, operation templates
// auto-increment per operation_id -- the two must never share a counter.
// When operation_id is given, its part_id is looked up server-side and used
// instead of whatever part_id the client sent, so the two can't mismatch.
//
// The new revision copies forward every balloon_point from the immediately
// prior version in the same bucket (same balloon_number/specs/sort_order/
// decimal_places, new drawing_id) so it starts as an editable copy rather
// than empty -- unless there is no prior version, in which case it starts
// empty exactly as before.
router.post("/", attachRole, requireRole("qc", "admin", "engineer", "supervisor"), upload.single("image"), (req, res) => {
  const { version, revision_label } = req.body;
  let { part_id, operation_id } = req.body;

  if (operation_id) {
    const operation = db.prepare("SELECT part_id FROM operations WHERE id = ?").get(operation_id);
    if (!operation) return res.status(404).json({ error: "Operation not found" });
    part_id = operation.part_id;
  } else if (!part_id) {
    return res.status(400).json({ error: "part_id is required (or operation_id)" });
  } else if (!db.prepare("SELECT 1 FROM parts WHERE id = ?").get(part_id)) {
    return res.status(404).json({ error: "Part not found" });
  }

  const priorDrawing = operation_id
    ? getPriorOperationDrawing.get(operation_id)
    : getPriorFinalDrawing.get(part_id);

  const nextVersion = version || (priorDrawing ? priorDrawing.version + 1 : 1);
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  const tx = db.transaction(() => {
    const result = insertDrawing.run(
      part_id,
      imagePath,
      nextVersion,
      revision_label?.trim() || null,
      operation_id || null
    );
    const newDrawingId = result.lastInsertRowid;

    if (priorDrawing) {
      for (const p of getPointsForDrawing.all(priorDrawing.id)) {
        insertPoint.run({
          drawing_id: newDrawingId,
          balloon_number: p.balloon_number,
          max_spec: p.max_spec,
          min_spec: p.min_spec,
          mean_value: p.mean_value,
          sort_order: p.sort_order,
          decimal_places: p.decimal_places,
          is_check_column: p.is_check_column,
          is_reference: p.is_reference,
        });
      }
    }

    return newDrawingId;
  });

  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(tx());
  res.status(201).json(drawing);
});

// PUT /api/drawings/:id  (edit the free-text revision label printed on the
// drawing's title block -- independent from the auto-incrementing version
// number used for "latest" ordering)
router.put("/:id", attachRole, requireRole("qc", "admin", "engineer", "supervisor"), (req, res) => {
  const { revision_label, hundred_percent_inspection, machine_log_mode } = req.body;
  // Built field-by-field (not a blanket COALESCE) since revision_label's own
  // "clear it" gesture is an empty string -- which needs to actually write
  // null, not fall through to "leave it alone" the way an omitted field does.
  const setClauses = [];
  const params = [];
  if (revision_label !== undefined) {
    setClauses.push("revision_label = ?");
    params.push(revision_label?.trim() || null);
  }
  if (hundred_percent_inspection !== undefined) {
    setClauses.push("hundred_percent_inspection = ?");
    params.push(hundred_percent_inspection ? 1 : 0);
  }
  if (machine_log_mode !== undefined) {
    setClauses.push("machine_log_mode = ?");
    params.push(machine_log_mode ? 1 : 0);
  }
  if (setClauses.length > 0) {
    params.push(req.params.id);
    const result = db.prepare(`UPDATE balloon_drawings SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);
    if (result.changes === 0) return res.status(404).json({ error: "Drawing not found" });
  }
  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(req.params.id);
  if (!drawing) return res.status(404).json({ error: "Drawing not found" });
  // Same shape as GET /:id (points included) -- the frontend keeps whatever
  // this returns as its current `drawing` state, and expects .points to
  // always be an array there.
  const points = db
    .prepare("SELECT * FROM balloon_points WHERE drawing_id = ? ORDER BY sort_order")
    .all(req.params.id);
  res.json({ ...drawing, points });
});

// DELETE /api/drawings/:id  (cascades to its balloon_points; blocked if any point
// already has recorded measurements, to protect quality records from deletion)
router.delete("/:id", attachRole, requireRole("qc", "admin", "supervisor"), (req, res) => {
  try {
    const result = db.prepare("DELETE FROM balloon_drawings WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Drawing not found" });
    res.status(204).send();
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY" || err.code === "SQLITE_CONSTRAINT_TRIGGER") {
      return res.status(409).json({
        error:
          "This drawing can't be deleted because it already has recorded inspection measurements. Upload a new revision instead — it becomes the active version automatically.",
      });
    }
    throw err;
  }
});

// POST /api/drawings/:id/points  (adds a point with its specification, appended
// to the end of the column order)
router.post("/:id/points", attachRole, requireRole("qc", "admin", "engineer", "supervisor"), (req, res) => {
  const { balloon_number, max_spec, min_spec, mean_value, decimal_places, is_check_column, is_reference } = req.body;
  if (!balloon_number) return res.status(400).json({ error: "balloon_number is required" });

  const { maxOrder } = db
    .prepare("SELECT MAX(sort_order) AS maxOrder FROM balloon_points WHERE drawing_id = ?")
    .get(req.params.id);
  const nextOrder = maxOrder == null ? 0 : maxOrder + 1;

  const result = db
    .prepare(
      `INSERT INTO balloon_points
       (drawing_id, balloon_number, max_spec, min_spec, mean_value, sort_order, decimal_places, is_check_column, is_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      balloon_number,
      max_spec ?? null,
      min_spec ?? null,
      mean_value ?? null,
      nextOrder,
      clampDecimalPlaces(decimal_places),
      is_check_column ? 1 : 0,
      is_reference ? 1 : 0
    );

  const point = db.prepare("SELECT * FROM balloon_points WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(point);
});

// PUT /api/drawings/points/:id  (edit an existing point's Find#, spec, or decimal places)
router.put("/points/:id", attachRole, requireRole("qc", "admin", "engineer", "supervisor"), (req, res) => {
  const { balloon_number, max_spec, min_spec, mean_value, decimal_places, is_check_column, is_reference } = req.body;
  if (!balloon_number) return res.status(400).json({ error: "balloon_number is required" });

  const result = db
    .prepare(
      `UPDATE balloon_points
       SET balloon_number = ?, max_spec = ?, min_spec = ?, mean_value = ?, decimal_places = ?, is_check_column = ?,
           is_reference = ?
       WHERE id = ?`
    )
    .run(
      balloon_number,
      max_spec ?? null,
      min_spec ?? null,
      mean_value ?? null,
      clampDecimalPlaces(decimal_places),
      is_check_column ? 1 : 0,
      is_reference ? 1 : 0,
      req.params.id
    );

  if (result.changes === 0) return res.status(404).json({ error: "Point not found" });
  res.json(db.prepare("SELECT * FROM balloon_points WHERE id = ?").get(req.params.id));
});

// DELETE /api/drawings/points/:id  (blocked if measurements already reference it)
router.delete("/points/:id", attachRole, requireRole("qc", "admin", "supervisor"), (req, res) => {
  try {
    const result = db.prepare("DELETE FROM balloon_points WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Point not found" });
    res.status(204).send();
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY" || err.code === "SQLITE_CONSTRAINT_TRIGGER") {
      return res.status(409).json({
        error: "This point can't be deleted because it already has recorded measurements.",
      });
    }
    throw err;
  }
});

module.exports = router;
