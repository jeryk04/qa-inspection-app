const express = require("express");
const db = require("../db");
const attachRole = require("../middleware/attachRole");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

// GET /api/parts?client_id=1
router.get("/", (req, res) => {
  const { client_id } = req.query;
  const parts = client_id
    ? db.prepare("SELECT * FROM parts WHERE client_id = ? ORDER BY part_number").all(client_id)
    : db.prepare("SELECT * FROM parts ORDER BY part_number").all();
  res.json(parts);
});

// GET /api/parts/:id
router.get("/:id", (req, res) => {
  const part = db.prepare("SELECT * FROM parts WHERE id = ?").get(req.params.id);
  if (!part) return res.status(404).json({ error: "Part not found" });
  res.json(part);
});

// POST /api/parts
router.post("/", (req, res) => {
  const { client_id, part_number, description } = req.body;
  if (!client_id || !part_number) {
    return res.status(400).json({ error: "client_id and part_number are required" });
  }

  try {
    const result = db
      .prepare("INSERT INTO parts (client_id, part_number, description) VALUES (?, ?, ?)")
      .run(client_id, part_number, description || null);

    const part = db.prepare("SELECT * FROM parts WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(part);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: `Part "${part_number}" already exists for this customer.` });
    }
    throw err;
  }
});

// PUT /api/parts/:id
router.put("/:id", (req, res) => {
  const { part_number, description } = req.body;
  try {
    const result = db
      .prepare("UPDATE parts SET part_number = COALESCE(?, part_number), description = COALESCE(?, description) WHERE id = ?")
      .run(part_number, description, req.params.id);

    if (result.changes === 0) return res.status(404).json({ error: "Part not found" });
    const part = db.prepare("SELECT * FROM parts WHERE id = ?").get(req.params.id);
    res.json(part);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: `Part "${part_number}" already exists for this customer.` });
    }
    throw err;
  }
});

// DELETE /api/parts/:id  (cascades to its drawings/inspections; blocked if any
// inspection already has recorded measurements, to protect quality records)
router.delete("/:id", attachRole, requireRole("qc", "admin"), (req, res) => {
  try {
    const result = db.prepare("DELETE FROM parts WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Part not found" });
    res.status(204).send();
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY" || err.code === "SQLITE_CONSTRAINT_TRIGGER") {
      return res.status(409).json({
        error: "This part can't be deleted because it already has recorded inspection measurements.",
      });
    }
    throw err;
  }
});

// GET /api/parts/:partId/operations  (list operations for a part)
router.get("/:partId/operations", (req, res) => {
  const operations = db
    .prepare("SELECT * FROM operations WHERE part_id = ? ORDER BY name")
    .all(req.params.partId);
  res.json(operations);
});

// POST /api/parts/:partId/operations  (create one; body: { name }) -- only
// qc/admin/engineer may create operations; operators can list but not create.
router.post("/:partId/operations", attachRole, requireRole("qc", "admin", "engineer"), (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: "name is required" });

  try {
    const result = db
      .prepare("INSERT INTO operations (part_id, name) VALUES (?, ?)")
      .run(req.params.partId, name);
    const operation = db.prepare("SELECT * FROM operations WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(operation);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: `An operation named "${name}" already exists for this part.` });
    }
    throw err;
  }
});

module.exports = router;
