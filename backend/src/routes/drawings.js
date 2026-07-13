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
    .prepare("SELECT * FROM balloon_points WHERE drawing_id = ? ORDER BY balloon_number")
    .all(req.params.id);

  res.json({ ...drawing, points });
});

// POST /api/drawings  (multipart/form-data: image + part_id)
router.post("/", upload.single("image"), (req, res) => {
  const { part_id, version } = req.body;
  if (!part_id || !req.file) {
    return res.status(400).json({ error: "part_id and image are required" });
  }

  const result = db
    .prepare("INSERT INTO balloon_drawings (part_id, image_path, version) VALUES (?, ?, ?)")
    .run(part_id, `/uploads/${req.file.filename}`, version || 1);

  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(drawing);
});

// POST /api/drawings/:id/points  (adds a numbered point with its specification)
router.post("/:id/points", (req, res) => {
  const { balloon_number, description, max_spec, min_spec, mean_value, unit } = req.body;
  if (!balloon_number) return res.status(400).json({ error: "balloon_number is required" });

  const result = db
    .prepare(
      `INSERT INTO balloon_points
       (drawing_id, balloon_number, description, max_spec, min_spec, mean_value, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      balloon_number,
      description || null,
      max_spec ?? null,
      min_spec ?? null,
      mean_value ?? null,
      unit || "mm"
    );

  const point = db.prepare("SELECT * FROM balloon_points WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(point);
});

module.exports = router;
