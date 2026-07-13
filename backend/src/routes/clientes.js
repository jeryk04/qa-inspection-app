const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/clientes
router.get("/", (req, res) => {
  const clientes = db.prepare("SELECT * FROM clientes ORDER BY nombre").all();
  res.json(clientes);
});

// GET /api/clientes/:id
router.get("/:id", (req, res) => {
  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ?").get(req.params.id);
  if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
  res.json(cliente);
});

// POST /api/clientes
router.post("/", (req, res) => {
  const { nombre, contacto } = req.body;
  if (!nombre) return res.status(400).json({ error: "nombre es requerido" });

  const result = db
    .prepare("INSERT INTO clientes (nombre, contacto) VALUES (?, ?)")
    .run(nombre, contacto || null);

  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(cliente);
});

// PUT /api/clientes/:id
router.put("/:id", (req, res) => {
  const { nombre, contacto } = req.body;
  const result = db
    .prepare("UPDATE clientes SET nombre = COALESCE(?, nombre), contacto = COALESCE(?, contacto) WHERE id = ?")
    .run(nombre, contacto, req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: "Cliente no encontrado" });
  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ?").get(req.params.id);
  res.json(cliente);
});

// DELETE /api/clientes/:id
router.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM clientes WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Cliente no encontrado" });
  res.status(204).send();
});

module.exports = router;
