const express = require("express");
const db = require("../db");
const attachRole = require("../middleware/attachRole");
const requireRole = require("../middleware/requireRole");
const { archiveOperation } = require("../lib/trash");
const { isAssignedToClient } = require("../lib/operatorAccess");
const { partSetupStatus } = require("../lib/partSetup");

const router = express.Router();

// GET /api/parts?client_id=1 -- Operators only see parts under a customer
// they're assigned to (see clients.js's GET / for the matching rule); a
// client_id they're not assigned to 403s rather than silently returning
// nothing, same as clients.js's GET /:id.
router.get("/", attachRole, (req, res) => {
  const { client_id } = req.query;
  if (req.user.role === "operator" && client_id && !isAssignedToClient(req.user.id, client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  let parts;
  if (client_id) {
    parts = db.prepare("SELECT * FROM parts WHERE client_id = ? ORDER BY part_number").all(client_id);
  } else if (req.user.role === "operator") {
    parts = db
      .prepare(
        `SELECT p.* FROM parts p
         JOIN user_clients uc ON uc.client_id = p.client_id
         WHERE uc.user_id = ?
         ORDER BY p.part_number`
      )
      .all(req.user.id);
  } else {
    parts = db.prepare("SELECT * FROM parts ORDER BY part_number").all();
  }
  res.json(parts);
});

// GET /api/parts/setup-status?client_id=1 -- every part of one customer's
// template/drawing setup per inspection type (see lib/partSetup.js), keyed
// by part id, for Browse Customers' parts list.
router.get("/setup-status", attachRole, (req, res) => {
  const clientId = Number(req.query.client_id);
  if (!Number.isInteger(clientId)) return res.status(400).json({ error: "client_id is required" });
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, clientId)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  const partIds = db.prepare("SELECT id FROM parts WHERE client_id = ?").all(clientId).map((p) => p.id);
  res.json(Object.fromEntries(partSetupStatus(partIds)));
});

// GET /api/parts/setup-summary?client_ids=1,2,3 -- per customer/supplier
// folder: how many parts, how many have the Final/Incoming template set up,
// and how many have its drawing attached (Browse Suppliers' list).
router.get("/setup-summary", attachRole, (req, res) => {
  const clientIds = String(req.query.client_ids || "")
    .split(",")
    .map(Number)
    .filter(Number.isInteger)
    .filter((id) => req.user.role !== "operator" || isAssignedToClient(req.user.id, id));
  const parts = clientIds.length
    ? db.prepare("SELECT id, client_id FROM parts WHERE client_id IN (SELECT value FROM json_each(?))").all(JSON.stringify(clientIds))
    : [];
  const status = partSetupStatus(parts.map((p) => p.id));
  const summary = Object.fromEntries(clientIds.map((id) => [id, { parts: 0, templates: 0, drawings: 0 }]));
  for (const p of parts) {
    const s = summary[p.client_id];
    const final = status.get(p.id).final;
    s.parts += 1;
    if (final.template) s.templates += 1;
    if (final.drawing) s.drawings += 1;
  }
  res.json(summary);
});

// GET /api/parts/:id/setup-status -- one part's setup per inspection type,
// with each operation listed (Browse Customers' part setup page).
router.get("/:id/setup-status", attachRole, (req, res) => {
  const part = db
    .prepare("SELECT p.*, c.name AS client_name FROM parts p JOIN clients c ON c.id = p.client_id WHERE p.id = ?")
    .get(req.params.id);
  if (!part) return res.status(404).json({ error: "Part not found" });
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, part.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  res.json({ part, status: partSetupStatus([part.id]).get(part.id) });
});

// GET /api/parts/:id
router.get("/:id", attachRole, (req, res) => {
  const part = db.prepare("SELECT * FROM parts WHERE id = ?").get(req.params.id);
  if (!part) return res.status(404).json({ error: "Part not found" });
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, part.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  res.json(part);
});

// POST /api/parts -- catalog maintenance, only ever submitted from the
// Browse Customers screen now (see frontend Parts.jsx's canManageCatalog);
// this is still the real enforcement, that's just UI. Previously had no
// role check at all (an Operator, if they reached Parts.jsx, could create
// one) -- now matches clients.js's POST /.
router.post("/", attachRole, requireRole("qc", "admin", "engineer", "supervisor", "qa_manager"), (req, res) => {
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
router.delete("/:id", attachRole, requireRole("qc", "admin", "supervisor", "qa_manager"), (req, res) => {
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

// GET /api/parts/:partId/operations[?scope=setup|in_process]  (list
// operations for a part -- Set-up/QC and In-Process/Operator each have
// their own independent list + Data Sheet Template for the same part, see
// schema.sql's operations.scope comment. No ?scope filters to everything,
// used by OperationDetail.jsx/DataSheetTemplate.jsx which already know the
// specific operationId they want and just need to find it in the list.)
router.get("/:partId/operations", attachRole, (req, res) => {
  if (req.user.role === "operator") {
    const part = db.prepare("SELECT client_id FROM parts WHERE id = ?").get(req.params.partId);
    if (part && !isAssignedToClient(req.user.id, part.client_id)) {
      return res.status(403).json({ error: "You're not assigned to this customer." });
    }
  }
  const { scope } = req.query;
  const operations = scope
    ? db.prepare("SELECT * FROM operations WHERE part_id = ? AND scope = ? ORDER BY name").all(req.params.partId, scope)
    : db.prepare("SELECT * FROM operations WHERE part_id = ? ORDER BY name").all(req.params.partId);
  res.json(operations);
});

const VALID_OPERATION_SCOPES = ["setup", "in_process_operator", "in_process_qc", "samples"];

// POST /api/parts/:partId/operations  (create one; body: { name, scope }) --
// only qc/admin/engineer may create operations; operators can list but not
// create. scope is required (not defaulted) so every caller has to say
// which of the three independent lists it's creating into (see schema.sql's
// operations.scope comment).
router.post("/:partId/operations", attachRole, requireRole("qc", "admin", "engineer", "supervisor", "qa_manager"), (req, res) => {
  const name = req.body.name?.trim();
  const { scope } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  if (!VALID_OPERATION_SCOPES.includes(scope)) {
    return res.status(400).json({ error: `scope must be one of: ${VALID_OPERATION_SCOPES.join(", ")}` });
  }

  try {
    const result = db
      .prepare("INSERT INTO operations (part_id, name, scope) VALUES (?, ?, ?)")
      .run(req.params.partId, name, scope);
    const operation = db.prepare("SELECT * FROM operations WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(operation);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: `An operation named "${name}" already exists for this part.` });
    }
    throw err;
  }
});

// PUT /api/parts/:partId/operations/:id  (rename; body: { name }) -- same
// roles as create.
router.put("/:partId/operations/:id", attachRole, requireRole("qc", "admin", "engineer", "supervisor", "qa_manager"), (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: "name is required" });

  try {
    const result = db
      .prepare("UPDATE operations SET name = ? WHERE id = ? AND part_id = ?")
      .run(name, req.params.id, req.params.partId);
    if (result.changes === 0) return res.status(404).json({ error: "Operation not found" });
    const operation = db.prepare("SELECT * FROM operations WHERE id = ?").get(req.params.id);
    res.json(operation);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: `An operation named "${name}" already exists for this part.` });
    }
    throw err;
  }
});

// DELETE /api/parts/:partId/operations/:id -- unlike parts/drawings, nothing
// cascades from operations at the FK level (balloon_drawings.operation_id
// and inspections.operation_id both reference it with no ON DELETE), so a
// plain DELETE would fail once a Data Sheet Template or inspections exist.
// Instead this always succeeds: the whole subtree (template + inspection
// history) is snapshotted into the admin recycle bin (see lib/trash.js)
// and then cascaded away manually, in dependency order, inside one
// transaction so the archive and the removal are atomic.
router.delete("/:partId/operations/:id", attachRole, requireRole("qc", "admin", "supervisor", "qa_manager"), (req, res) => {
  const operation = db
    .prepare("SELECT * FROM operations WHERE id = ? AND part_id = ?")
    .get(req.params.id, req.params.partId);
  if (!operation) return res.status(404).json({ error: "Operation not found" });
  const part = db.prepare("SELECT * FROM parts WHERE id = ?").get(operation.part_id);

  const tx = db.transaction(() => {
    archiveOperation(db, operation, part, req.user.id);

    const inspectionIds = db
      .prepare("SELECT id FROM inspections WHERE operation_id = ?")
      .all(operation.id)
      .map((r) => r.id);
    if (inspectionIds.length > 0) {
      db.prepare(
        `DELETE FROM audit_log WHERE entity_type = 'inspection' AND entity_id IN (${inspectionIds
          .map(() => "?")
          .join(",")})`
      ).run(...inspectionIds);
    }
    // Cascades to measurements/inspection_point_summaries/signatures (ON DELETE CASCADE).
    db.prepare("DELETE FROM inspections WHERE operation_id = ?").run(operation.id);
    // Cascades to balloon_points (ON DELETE CASCADE).
    db.prepare("DELETE FROM balloon_drawings WHERE operation_id = ?").run(operation.id);
    db.prepare("DELETE FROM operations WHERE id = ?").run(operation.id);
  });
  tx();

  res.status(204).send();
});

module.exports = router;
