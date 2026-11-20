const express = require("express");
const multer = require("multer");
const path = require("path");
const db = require("../db");
const attachRole = require("../middleware/attachRole");
const requireRole = require("../middleware/requireRole");
const { recordAudit } = require("../lib/audit");
const { recomputePointTolerance } = require("../lib/tolerance");

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

// Every drawing file on one revision, in display order: image_path first
// (id "primary"), then the extra files from balloon_drawing_files.
function getDrawingFiles(drawing) {
  const extras = db
    .prepare("SELECT id, file_path, original_name FROM balloon_drawing_files WHERE drawing_id = ? ORDER BY sort_order, id")
    .all(drawing.id);
  return [
    ...(drawing.image_path ? [{ id: "primary", file_path: drawing.image_path, original_name: null }] : []),
    ...extras,
  ];
}

// The full drawing shape every read/write route returns: the row plus its
// active points (retired ones are only shown on the past inspections that
// used them, see getInspectionDetail) and its drawing files.
function getDrawingDetail(id) {
  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(id);
  if (!drawing) return null;
  const points = db
    .prepare("SELECT * FROM balloon_points WHERE drawing_id = ? AND retired_at IS NULL ORDER BY sort_order")
    .all(id);
  return { ...drawing, points, files: getDrawingFiles(drawing) };
}

// GET /api/drawings/:id
router.get("/:id", (req, res) => {
  const drawing = getDrawingDetail(req.params.id);
  if (!drawing) return res.status(404).json({ error: "Drawing not found" });
  res.json(drawing);
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
const getPointsForDrawing = db.prepare(
  "SELECT * FROM balloon_points WHERE drawing_id = ? AND retired_at IS NULL ORDER BY sort_order"
);
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
router.post("/", attachRole, requireRole("qc", "admin", "engineer", "supervisor", "qa_manager"), upload.single("image"), (req, res) => {
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
      // A new revision of the same operation keeps its reminder schedule.
      db.prepare(
        "UPDATE balloon_drawings SET reinspect_interval_minutes = (SELECT reinspect_interval_minutes FROM balloon_drawings WHERE id = ?) WHERE id = ?"
      ).run(priorDrawing.id, newDrawingId);
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
router.put("/:id", attachRole, requireRole("qc", "admin", "engineer", "supervisor", "qa_manager"), (req, res) => {
  const { revision_label, hundred_percent_inspection, machine_log_mode, reinspect_interval_minutes } = req.body;
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
  // null/"" turns the reminder off; otherwise whole minutes, up to 24h.
  if (reinspect_interval_minutes !== undefined) {
    const off = reinspect_interval_minutes === null || reinspect_interval_minutes === "";
    const minutes = Number(reinspect_interval_minutes);
    if (!off && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
      return res.status(400).json({ error: "The re-inspection reminder must be between 1 minute and 24 hours." });
    }
    setClauses.push("reinspect_interval_minutes = ?");
    params.push(off ? null : minutes);
  }
  if (setClauses.length > 0) {
    params.push(req.params.id);
    const result = db.prepare(`UPDATE balloon_drawings SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);
    if (result.changes === 0) return res.status(404).json({ error: "Drawing not found" });
  }
  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(req.params.id);
  if (!drawing) return res.status(404).json({ error: "Drawing not found" });
  // Still-open Data Sheets on this template follow its mode flags (the
  // capture page already reads them live from the template), so the sheet's
  // own copy -- what View/Print, the PDF and signing use -- must follow too.
  // Signed sheets keep whatever they were signed with.
  if (hundred_percent_inspection !== undefined || machine_log_mode !== undefined) {
    db.prepare(
      `UPDATE inspections SET hundred_percent_inspection = ?, machine_log_mode = ?
       WHERE drawing_id = ? AND status = 'in_progress'`
    ).run(drawing.hundred_percent_inspection, drawing.machine_log_mode, drawing.id);
  }
  // Same shape as GET /:id (points and files included) -- the frontend keeps
  // whatever this returns as its current `drawing` state, and expects
  // .points to always be an array there.
  res.json(getDrawingDetail(drawing.id));
});

// POST /api/drawings/:id/files  (multipart/form-data: image required) --
// attaches another drawing file to this same revision, without creating a
// new revision. If the revision has no drawing yet, the file becomes its
// first drawing (image_path).
router.post("/:id/files", attachRole, requireRole("qc", "admin", "engineer", "supervisor", "qa_manager"), upload.single("image"), (req, res) => {
  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(req.params.id);
  if (!drawing) return res.status(404).json({ error: "Drawing not found" });
  if (!req.file) return res.status(400).json({ error: "A drawing file is required." });

  const filePath = `/uploads/${req.file.filename}`;
  if (!drawing.image_path) {
    db.prepare("UPDATE balloon_drawings SET image_path = ? WHERE id = ?").run(filePath, drawing.id);
  } else {
    const { maxOrder } = db
      .prepare("SELECT MAX(sort_order) AS maxOrder FROM balloon_drawing_files WHERE drawing_id = ?")
      .get(drawing.id);
    db.prepare(
      "INSERT INTO balloon_drawing_files (drawing_id, file_path, original_name, sort_order) VALUES (?, ?, ?, ?)"
    ).run(drawing.id, filePath, req.file.originalname, maxOrder == null ? 0 : maxOrder + 1);
  }
  res.status(201).json(getDrawingDetail(drawing.id));
});

// DELETE /api/drawings/:id/files/:fileId  (fileId is an extra file's id, or
// "primary" for the first drawing). A revision always keeps at least one
// drawing once it has one -- past Data Sheets on it show its Rev only while
// a drawing is attached -- so removing the first drawing promotes the next
// one into its place, and removing the only drawing is refused.
router.delete("/:id/files/:fileId", attachRole, requireRole("qc", "admin", "supervisor", "qa_manager"), (req, res) => {
  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(req.params.id);
  if (!drawing) return res.status(404).json({ error: "Drawing not found" });

  const files = getDrawingFiles(drawing);
  if (!files.some((f) => String(f.id) === req.params.fileId)) {
    return res.status(404).json({ error: "Drawing file not found" });
  }
  if (files.length < 2) {
    return res.status(409).json({
      error: "This is the only drawing on this revision, so it can't be removed. Add the correct drawing first, then remove this one.",
    });
  }

  db.transaction(() => {
    if (req.params.fileId === "primary") {
      const next = files[1];
      db.prepare("UPDATE balloon_drawings SET image_path = ? WHERE id = ?").run(next.file_path, drawing.id);
      db.prepare("DELETE FROM balloon_drawing_files WHERE id = ?").run(next.id);
    } else {
      db.prepare("DELETE FROM balloon_drawing_files WHERE id = ? AND drawing_id = ?").run(req.params.fileId, drawing.id);
    }
  })();
  res.json(getDrawingDetail(drawing.id));
});

// DELETE /api/drawings/:id  (cascades to its balloon_points; blocked if any point
// already has recorded measurements, to protect quality records from deletion)
router.delete("/:id", attachRole, requireRole("qc", "admin", "supervisor", "qa_manager"), (req, res) => {
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
router.post("/:id/points", attachRole, requireRole("qc", "admin", "engineer", "supervisor", "qa_manager"), (req, res) => {
  const { balloon_number, max_spec, min_spec, mean_value, decimal_places, is_check_column, is_reference } = req.body;
  if (!balloon_number) return res.status(400).json({ error: "balloon_number is required" });

  const { maxOrder } = db
    .prepare("SELECT MAX(sort_order) AS maxOrder FROM balloon_points WHERE drawing_id = ?")
    .get(req.params.id);
  const nextOrder = maxOrder == null ? 0 : maxOrder + 1;

  let result;
  try {
    result = db
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
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: duplicateFindMessage(req.params.id, balloon_number) });
    }
    throw err;
  }

  const point = db.prepare("SELECT * FROM balloon_points WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(point);
});

// PUT /api/drawings/:id/points/order  (body: { point_ids: [...] } -- every
// active point on the drawing, in its new column order). Retired points keep
// their sort_order; they only ever show on past sheets anyway.
router.put("/:id/points/order", attachRole, requireRole("qc", "admin", "engineer", "supervisor", "qa_manager"), (req, res) => {
  const ids = req.body.point_ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "point_ids must be an array" });

  const active = db
    .prepare("SELECT id FROM balloon_points WHERE drawing_id = ? AND retired_at IS NULL")
    .all(req.params.id)
    .map((p) => p.id);
  const given = new Set(ids.map(Number));
  if (given.size !== ids.length || given.size !== active.length || !active.every((id) => given.has(id))) {
    return res.status(409).json({
      error: "This template's Find# columns changed since the page was loaded. Reload the page and try again.",
    });
  }

  const setOrder = db.prepare("UPDATE balloon_points SET sort_order = ? WHERE id = ?");
  db.transaction(() => ids.forEach((id, index) => setOrder.run(index, id)))();

  res.json(
    db
      .prepare("SELECT * FROM balloon_points WHERE drawing_id = ? AND retired_at IS NULL ORDER BY sort_order")
      .all(req.params.id)
  );
});

// PUT /api/drawings/points/:id  (edit an existing point's Find#, spec, or decimal places)
router.put("/points/:id", attachRole, requireRole("qc", "admin", "engineer", "supervisor", "qa_manager"), (req, res) => {
  const { balloon_number, max_spec, min_spec, mean_value, decimal_places, is_check_column, is_reference } = req.body;
  if (!balloon_number) return res.status(400).json({ error: "balloon_number is required" });

  const before = db.prepare("SELECT * FROM balloon_points WHERE id = ?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Point not found" });

  // Saving the new spec and re-checking every existing reading against it
  // happen together -- see recomputePointTolerance for why.
  const save = db.transaction(() => {
    db.prepare(
      `UPDATE balloon_points
       SET balloon_number = ?, max_spec = ?, min_spec = ?, mean_value = ?, decimal_places = ?, is_check_column = ?,
           is_reference = ?
       WHERE id = ?`
    ).run(
      balloon_number,
      max_spec ?? null,
      min_spec ?? null,
      mean_value ?? null,
      clampDecimalPlaces(decimal_places),
      is_check_column ? 1 : 0,
      is_reference ? 1 : 0,
      req.params.id
    );
    const point = db.prepare("SELECT * FROM balloon_points WHERE id = ?").get(req.params.id);
    return recomputePointTolerance(db, point);
  });
  let changed;
  try {
    changed = save();
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: duplicateFindMessage(before.drawing_id, balloon_number) });
    }
    throw err;
  }

  // A spec change that flipped any pass/fail result is logged on each affected
  // Data Sheet's History, with the old and new spec, so it's traceable.
  const byInspection = new Map();
  for (const r of changed) {
    if (!byInspection.has(r.inspection_id)) byInspection.set(r.inspection_id, []);
    byInspection.get(r.inspection_id).push(r);
  }
  for (const [inspectionId, readings] of byInspection) {
    recordAudit("inspection", inspectionId, "tolerance_rechecked", req.user.id, {
      balloon_number,
      old_spec: { min: before.min_spec, max: before.max_spec },
      new_spec: { min: min_spec ?? null, max: max_spec ?? null },
      changes: readings.map((r) => ({
        sample_number: r.sample_number,
        value: r.measured_value,
        old_within_tolerance: r.within_tolerance,
        new_within_tolerance: r.new_within_tolerance,
      })),
    });
  }

  res.json(db.prepare("SELECT * FROM balloon_points WHERE id = ?").get(req.params.id));
});

// DELETE /api/drawings/points/:id  (hard-deletes a point nothing has recorded
// against yet; one that already has readings is retired instead -- gone from
// the template and from new inspections, but still shown on the past
// inspections that recorded it, see retired_at in schema.sql)
router.delete("/points/:id", attachRole, requireRole("qc", "admin", "supervisor", "qa_manager"), (req, res) => {
  const point = db.prepare("SELECT id FROM balloon_points WHERE id = ? AND retired_at IS NULL").get(req.params.id);
  if (!point) return res.status(404).json({ error: "Point not found" });
  try {
    db.prepare("DELETE FROM balloon_points WHERE id = ?").run(point.id);
  } catch (err) {
    if (err.code !== "SQLITE_CONSTRAINT_FOREIGNKEY" && err.code !== "SQLITE_CONSTRAINT_TRIGGER") throw err;
    db.prepare("UPDATE balloon_points SET retired_at = datetime('now') WHERE id = ?").run(point.id);
  }
  res.status(204).send();
});

// UNIQUE(drawing_id, balloon_number) still covers retired points, so a
// retired Find#'s label can't be reused on the same revision -- explains
// that instead of a bare constraint error.
function duplicateFindMessage(drawingId, balloonNumber) {
  const retired = db
    .prepare("SELECT 1 FROM balloon_points WHERE drawing_id = ? AND balloon_number = ? AND retired_at IS NOT NULL")
    .get(drawingId, balloonNumber);
  return retired
    ? `Find# ${balloonNumber} was deleted from this template but is kept on past inspections, so it can't be reused on this revision. Use a different Find#, or upload a new revision.`
    : `Find# ${balloonNumber} already exists on this template.`;
}

module.exports = router;
