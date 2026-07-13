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

// GET /api/drawings?pieza_id=1
router.get("/", (req, res) => {
  const { pieza_id } = req.query;
  const drawings = pieza_id
    ? db.prepare("SELECT * FROM balloon_drawings WHERE pieza_id = ? ORDER BY version DESC").all(pieza_id)
    : db.prepare("SELECT * FROM balloon_drawings ORDER BY creado_en DESC").all();
  res.json(drawings);
});

// GET /api/drawings/:id  (incluye sus puntos)
router.get("/:id", (req, res) => {
  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(req.params.id);
  if (!drawing) return res.status(404).json({ error: "Drawing no encontrado" });

  const puntos = db
    .prepare("SELECT * FROM balloon_puntos WHERE drawing_id = ? ORDER BY numero_balloon")
    .all(req.params.id);

  res.json({ ...drawing, puntos });
});

// POST /api/drawings  (multipart/form-data: imagen + pieza_id)
router.post("/", upload.single("imagen"), (req, res) => {
  const { pieza_id, version } = req.body;
  if (!pieza_id || !req.file) {
    return res.status(400).json({ error: "pieza_id e imagen son requeridos" });
  }

  const result = db
    .prepare("INSERT INTO balloon_drawings (pieza_id, imagen_path, version) VALUES (?, ?, ?)")
    .run(pieza_id, `/uploads/${req.file.filename}`, version || 1);

  const drawing = db.prepare("SELECT * FROM balloon_drawings WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(drawing);
});

// POST /api/drawings/:id/puntos  (agrega un punto numerado con su especificación)
router.post("/:id/puntos", (req, res) => {
  const { numero_balloon, descripcion, valor_nominal, tolerancia_menos, tolerancia_mas, unidad } = req.body;
  if (!numero_balloon) return res.status(400).json({ error: "numero_balloon es requerido" });

  const result = db
    .prepare(
      `INSERT INTO balloon_puntos
       (drawing_id, numero_balloon, descripcion, valor_nominal, tolerancia_menos, tolerancia_mas, unidad)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      numero_balloon,
      descripcion || null,
      valor_nominal ?? null,
      tolerancia_menos ?? null,
      tolerancia_mas ?? null,
      unidad || "mm"
    );

  const punto = db.prepare("SELECT * FROM balloon_puntos WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(punto);
});

module.exports = router;
