const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/piezas?cliente_id=1
router.get("/", (req, res) => {
  const { cliente_id } = req.query;
  const piezas = cliente_id
    ? db.prepare("SELECT * FROM piezas WHERE cliente_id = ? ORDER BY numero_parte").all(cliente_id)
    : db.prepare("SELECT * FROM piezas ORDER BY numero_parte").all();
  res.json(piezas);
});

// GET /api/piezas/:id
router.get("/:id", (req, res) => {
  const pieza = db.prepare("SELECT * FROM piezas WHERE id = ?").get(req.params.id);
  if (!pieza) return res.status(404).json({ error: "Pieza no encontrada" });
  res.json(pieza);
});

// POST /api/piezas
router.post("/", (req, res) => {
  const { cliente_id, numero_parte, descripcion } = req.body;
  if (!cliente_id || !numero_parte) {
    return res.status(400).json({ error: "cliente_id y numero_parte son requeridos" });
  }

  const result = db
    .prepare("INSERT INTO piezas (cliente_id, numero_parte, descripcion) VALUES (?, ?, ?)")
    .run(cliente_id, numero_parte, descripcion || null);

  const pieza = db.prepare("SELECT * FROM piezas WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(pieza);
});

// PUT /api/piezas/:id
router.put("/:id", (req, res) => {
  const { numero_parte, descripcion } = req.body;
  const result = db
    .prepare("UPDATE piezas SET numero_parte = COALESCE(?, numero_parte), descripcion = COALESCE(?, descripcion) WHERE id = ?")
    .run(numero_parte, descripcion, req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: "Pieza no encontrada" });
  const pieza = db.prepare("SELECT * FROM piezas WHERE id = ?").get(req.params.id);
  res.json(pieza);
});

// DELETE /api/piezas/:id
router.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM piezas WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Pieza no encontrada" });
  res.status(204).send();
});

module.exports = router;
