const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { restoreEntity } = require("../lib/trash");

// Mounted with requireAuth/attachRole/requireRole("admin") already applied
// in index.js -- every route here is admin-only, so it's gated once at
// mount time instead of per-route like the other route files.
const router = express.Router();

// GET /api/admin/trash -- items still in the recycle bin, newest first.
router.get("/trash", (req, res) => {
  const items = db
    .prepare(
      `SELECT d.id, d.entity_type, d.entity_id, d.label, d.deleted_at, u.full_name AS deleted_by_name
       FROM deleted_items d
       LEFT JOIN users u ON u.id = d.deleted_by
       WHERE d.restored_at IS NULL
       ORDER BY d.deleted_at DESC`
    )
    .all();
  res.json(items);
});

// POST /api/admin/trash/:id/restore
router.post("/trash/:id/restore", (req, res) => {
  const row = db.prepare("SELECT * FROM deleted_items WHERE id = ? AND restored_at IS NULL").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Item not found (or already restored)" });

  try {
    db.transaction(() => restoreEntity(db, row, req.user.id))();
    res.status(204).send();
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "This can't be restored — something with the same name already exists." });
    }
    throw err;
  }
});

// DELETE /api/admin/trash/:id -- permanent purge. The underlying data is
// already gone from the live tables; this just clears the recycle bin row.
router.delete("/trash/:id", (req, res) => {
  const result = db.prepare("DELETE FROM deleted_items WHERE id = ? AND restored_at IS NULL").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Item not found (or already restored)" });
  res.status(204).send();
});

// GET /api/admin/users -- never returns password_hash.
router.get("/users", (req, res) => {
  const users = db
    .prepare("SELECT id, username, full_name, role, active, created_at FROM users ORDER BY full_name")
    .all();
  const clientRows = db.prepare("SELECT user_id, client_id FROM user_clients").all();
  const clientIdsByUser = new Map();
  clientRows.forEach((r) => {
    if (!clientIdsByUser.has(r.user_id)) clientIdsByUser.set(r.user_id, []);
    clientIdsByUser.get(r.user_id).push(r.client_id);
  });
  res.json(users.map((u) => ({ ...u, client_ids: clientIdsByUser.get(u.id) || [] })));
});

// POST /api/admin/users  { username, password, full_name, role }
router.post("/users", (req, res) => {
  const { username, password, full_name, role } = req.body;
  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: "username, password, full_name, and role are required" });
  }

  try {
    const password_hash = bcrypt.hashSync(password, 10);
    // Any admin-set password is a temporary one -- the account owner is
    // forced to pick their own on first login (see auth.js's PUT /password).
    const result = db
      .prepare("INSERT INTO users (username, password_hash, full_name, role, must_change_password) VALUES (?, ?, ?, ?, 1)")
      .run(username, password_hash, full_name, role);
    const user = db
      .prepare("SELECT id, username, full_name, role, active, created_at FROM users WHERE id = ?")
      .get(result.lastInsertRowid);
    res.status(201).json({ ...user, client_ids: [] });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: `Username "${username}" is already taken.` });
    }
    throw err;
  }
});

// PUT /api/admin/users/:id  { full_name?, role?, active?, password? }
router.put("/users/:id", (req, res) => {
  const { full_name, role, active, password } = req.body;

  const setClauses = [];
  const params = [];
  if (full_name !== undefined) {
    setClauses.push("full_name = ?");
    params.push(full_name);
  }
  if (role !== undefined) {
    setClauses.push("role = ?");
    params.push(role);
  }
  if (active !== undefined) {
    setClauses.push("active = ?");
    params.push(active ? 1 : 0);
  }
  if (password) {
    setClauses.push("password_hash = ?", "must_change_password = 1");
    params.push(bcrypt.hashSync(password, 10));
  }
  if (setClauses.length > 0) {
    params.push(req.params.id);
    const result = db.prepare(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);
    if (result.changes === 0) return res.status(404).json({ error: "User not found" });
  }

  const user = db
    .prepare("SELECT id, username, full_name, role, active, created_at FROM users WHERE id = ?")
    .get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const clientIds = db.prepare("SELECT client_id FROM user_clients WHERE user_id = ?").all(req.params.id);
  res.json({ ...user, client_ids: clientIds.map((r) => r.client_id) });
});

// PUT /api/admin/users/:id/clients  { client_ids: [...] } -- informational
// only (see schema.sql's user_clients comment); replaces the full set.
router.put("/users/:id/clients", (req, res) => {
  const { client_ids } = req.body;
  if (!Array.isArray(client_ids)) return res.status(400).json({ error: "client_ids must be an array" });

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const insertLink = db.prepare("INSERT INTO user_clients (user_id, client_id) VALUES (?, ?)");
  db.transaction(() => {
    db.prepare("DELETE FROM user_clients WHERE user_id = ?").run(req.params.id);
    client_ids.forEach((clientId) => insertLink.run(req.params.id, clientId));
  })();

  res.json({ client_ids });
});

// DELETE /api/admin/users/:id[?force=true] -- a real delete, unlike the rest
// of the app's entities: a user only has real "history" once they've
// actually created/signed inspections or shown up in the recycle bin
// (created_by/updated_by, signatures.user_id, audit_log.user_id,
// deleted_items.deleted_by/restored_by all reference users(id) with no
// cascade), so this succeeds outright for a throwaway/test account and
// fails with a clear reason for one with real activity on record -- same
// try/catch-FK pattern as clients/parts/drawings. Deactivating (PUT
// active:false) is still the right move for a real user leaving the
// company, to keep their name on the records they signed.
//
// force=true additionally clears audit_log rows and deleted_items
// deleted_by/restored_by attributions for this user first -- those are
// pure bookkeeping about who did something, not the something itself, so
// it's safe to scrub for a confirmed test/throwaway account. It does NOT
// touch inspections.created_by/updated_by or signatures.user_id -- those
// ARE the substantive compliance record (who created/signed an actual
// Data Sheet), so a user with real ones still blocks deletion even under
// force. Not exposed as a UI button -- deliberately harder to reach than
// the plain delete, since it destroys audit trail.
router.delete("/users/:id", (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account." });
  }
  const force = req.query.force === "true";

  try {
    const result = db.transaction(() => {
      if (force) {
        db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(req.params.id);
        db.prepare("UPDATE deleted_items SET deleted_by = NULL WHERE deleted_by = ?").run(req.params.id);
        db.prepare("UPDATE deleted_items SET restored_by = NULL WHERE restored_by = ?").run(req.params.id);
      }
      return db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
    })();
    if (result.changes === 0) return res.status(404).json({ error: "User not found" });
    res.status(204).send();
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY" || err.code === "SQLITE_CONSTRAINT_TRIGGER") {
      return res.status(409).json({
        error: force
          ? "This user can't be deleted even with force: they have real inspections created/updated or signatures on record, not just logs. Deactivate them instead."
          : "This user can't be deleted because they have activity on record (inspections, signatures, or recycle bin history). Deactivate them instead.",
      });
    }
    throw err;
  }
});

module.exports = router;
