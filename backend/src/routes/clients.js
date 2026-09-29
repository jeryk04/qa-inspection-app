const express = require("express");
const db = require("../db");
const attachRole = require("../middleware/attachRole");
const requireRole = require("../middleware/requireRole");
const { isAssignedToClient } = require("../lib/operatorAccess");

const router = express.Router();

// GET /api/clients -- Operators only see customers an admin has assigned
// them to (Admin > Users' "Assigned customers", see user_clients in
// schema.sql); every other role sees every customer, unfiltered.
router.get("/", attachRole, (req, res) => {
  const clients =
    req.user.role === "operator"
      ? db
          .prepare(
            `SELECT c.* FROM clients c
             JOIN user_clients uc ON uc.client_id = c.id
             WHERE uc.user_id = ?
             ORDER BY c.name`
          )
          .all(req.user.id)
      : db.prepare("SELECT * FROM clients ORDER BY name").all();
  res.json(clients);
});

// GET /api/clients/:id
router.get("/:id", attachRole, (req, res) => {
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, client.id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  res.json(client);
});

// POST /api/clients -- catalog maintenance, only ever submitted from the
// Browse Customers screen now (see frontend Clients.jsx's isBrowseMode);
// this is still the real enforcement, that's just UI.
router.post("/", attachRole, requireRole("qc", "admin", "engineer", "supervisor"), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const result = db.prepare("INSERT INTO clients (name) VALUES (?)").run(name);

  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(client);
});

// PUT /api/clients/:id
router.put("/:id", attachRole, requireRole("qc", "admin", "supervisor"), (req, res) => {
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
router.delete("/:id", attachRole, requireRole("qc", "admin", "supervisor"), (req, res) => {
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
