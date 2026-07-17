const express = require("express");
const multer = require("multer");
const path = require("path");
const db = require("../db");

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

// GET /api/drawings?part_id=1
router.get("/", (req, res) => {
  const { part_id } = req.query;
  const drawings = part_id
    ? db.prepare("SELECT * FROM balloon_drawings WHERE part_id = ? ORDER BY version DESC").all(part_id)
    : db.prepare("SELECT * FROM balloon_drawings ORDER BY created_at DESC").all();
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

// POST /api/drawings  (multipart/form-data: part_id required, image optional;
// image/PDF both accepted). A drawing revision can exist without an image —
// e.g. so its Find# columns/specs can be set up before a drawing is ready to
// upload. Auto-increments version to (highest existing version for this
// part) + 1, unless explicitly provided.
router.post("/", upload.single("image"), (req, res) => {
  const { part_id, version } = req.body;
  if (!part_id) {
    return res.status(400).json({ error: "part_id is required" });
  }

  let nextVersion = version;
  if (!nextVersion) {
    const row = db
      .prepare("SELECT MAX(version) AS maxVersion FROM balloon_drawings WHERE part_id = ?")
      .get(part_id);
    nextVersion = (row.maxVersion || 0) + 1;
  }

  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
  const result = db
    .prepare("INSERT INTO balloon_drawings (part_id, image_path, version) VALUES (?, ?, ?)")
    .run(part_id, imagePath, nextVersion);

  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(drawing);
});

// DELETE /api/drawings/:id  (cascades to its balloon_points; blocked if any point
// already has recorded measurements, to protect quality records from deletion)
router.delete("/:id", (req, res) => {
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
router.post("/:id/points", (req, res) => {
  const { balloon_number, max_spec, min_spec, mean_value, decimal_places } = req.body;
  if (!balloon_number) return res.status(400).json({ error: "balloon_number is required" });

  const { maxOrder } = db
    .prepare("SELECT MAX(sort_order) AS maxOrder FROM balloon_points WHERE drawing_id = ?")
    .get(req.params.id);
  const nextOrder = maxOrder == null ? 0 : maxOrder + 1;

  const result = db
    .prepare(
      `INSERT INTO balloon_points
       (drawing_id, balloon_number, max_spec, min_spec, mean_value, sort_order, decimal_places)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      balloon_number,
      max_spec ?? null,
      min_spec ?? null,
      mean_value ?? null,
      nextOrder,
      clampDecimalPlaces(decimal_places)
    );

  const point = db.prepare("SELECT * FROM balloon_points WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(point);
});

// PUT /api/drawings/points/:id  (edit an existing point's Find#, spec, or decimal places)
router.put("/points/:id", (req, res) => {
  const { balloon_number, max_spec, min_spec, mean_value, decimal_places } = req.body;
  if (!balloon_number) return res.status(400).json({ error: "balloon_number is required" });

  const result = db
    .prepare(
      `UPDATE balloon_points
       SET balloon_number = ?, max_spec = ?, min_spec = ?, mean_value = ?, decimal_places = ?
       WHERE id = ?`
    )
    .run(
      balloon_number,
      max_spec ?? null,
      min_spec ?? null,
      mean_value ?? null,
      clampDecimalPlaces(decimal_places),
      req.params.id
    );

  if (result.changes === 0) return res.status(404).json({ error: "Point not found" });
  res.json(db.prepare("SELECT * FROM balloon_points WHERE id = ?").get(req.params.id));
});

// DELETE /api/drawings/points/:id  (blocked if measurements already reference it)
router.delete("/points/:id", (req, res) => {
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
