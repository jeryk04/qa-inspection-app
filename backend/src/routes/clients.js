const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/clients
router.get("/", (req, res) => {
  const clients = db.prepare("SELECT * FROM clients ORDER BY name").all();
  res.json(clients);
});

// GET /api/clients/:id
router.get("/:id", (req, res) => {
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });
  res.json(client);
});

// POST /api/clients
router.post("/", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const result = db.prepare("INSERT INTO clients (name) VALUES (?)").run(name);

  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(client);
});

// PUT /api/clients/:id
router.put("/:id", (req, res) => {
  const { name } = req.body;
  const result = db
    .prepare("UPDATE clients SET name = COALESCE(?, name) WHERE id = ?")
    .run(name, req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: "Client not found" });
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
  res.json(client);
});

// DELETE /api/clients/:id  (cascades to its parts/drawings/inspections; blocked if
// any inspection already has recorded measurements, to protect quality records)
router.delete("/:id", (req, res) => {
  try {
    const result = db.prepare("DELETE FROM clients WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Client not found" });
    res.status(204).send();
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY" || err.code === "SQLITE_CONSTRAINT_TRIGGER") {
      return res.status(409).json({
        error:
          "This customer can't be deleted because one of its parts already has recorded inspection measurements.",
      });
    }
    throw err;
  }
});

module.exports = router;
