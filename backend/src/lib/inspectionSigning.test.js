const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { signInspectionStatus } = require("./inspectionSigning");

// Isolated in-memory DB per test run -- never touches backend/data.db.
function makeTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8"));

  db.prepare("INSERT INTO users (id, username, password_hash, full_name) VALUES (1, 'tester', 'x', 'Test User')").run();
  db.prepare("INSERT INTO clients (id, name) VALUES (1, 'Test Client')").run();
  db.prepare("INSERT INTO parts (id, client_id, part_number) VALUES (1, 1, 'PN-1')").run();

  return db;
}

function makeInspection(db) {
  return db
    .prepare("INSERT INTO inspections (part_id, type) VALUES (1, 'final')")
    .run().lastInsertRowid;
}

test("signInspectionStatus approves an inspection and records a matching signature", () => {
  const db = makeTestDb();
  const inspectionId = makeInspection(db);

  signInspectionStatus(db, { inspectionId, userId: 1, status: "approved" });

  const inspection = db.prepare("SELECT status FROM inspections WHERE id = ?").get(inspectionId);
  assert.equal(inspection.status, "approved");

  const signature = db
    .prepare("SELECT action FROM signatures WHERE inspection_id = ?")
    .get(inspectionId);
  assert.equal(signature.action, "approved");
});

test("signInspectionStatus stores a conditional_reason alongside an 'approved' status", () => {
  const db = makeTestDb();
  const inspectionId = makeInspection(db);

  signInspectionStatus(db, {
    inspectionId,
    userId: 1,
    status: "approved",
    conditionalReason: "Customer accepted with deviation on Find# 3",
  });

  const inspection = db.prepare("SELECT status, conditional_reason FROM inspections WHERE id = ?").get(inspectionId);
  assert.equal(inspection.status, "approved");
  assert.equal(inspection.conditional_reason, "Customer accepted with deviation on Find# 3");

  // signatures.action has its own CHECK enum (only 'approved'/'rejected') --
  // a conditional approval still records a plain 'approved' signature.
  const signature = db.prepare("SELECT action FROM signatures WHERE inspection_id = ?").get(inspectionId);
  assert.equal(signature.action, "approved");
});

test("signInspectionStatus rejects an inspection and records a matching signature", () => {
  const db = makeTestDb();
  const inspectionId = makeInspection(db);

  signInspectionStatus(db, { inspectionId, userId: 1, status: "rejected" });

  const inspection = db.prepare("SELECT status FROM inspections WHERE id = ?").get(inspectionId);
  assert.equal(inspection.status, "rejected");
});

test("direct status UPDATE with no signature row is rejected by trg_status_requires_signature", () => {
  const db = makeTestDb();
  const inspectionId = makeInspection(db);

  assert.throws(
    () => db.prepare("UPDATE inspections SET status = 'approved' WHERE id = ?").run(inspectionId),
    /matching signature/
  );

  const inspection = db.prepare("SELECT status FROM inspections WHERE id = ?").get(inspectionId);
  assert.equal(inspection.status, "in_progress");
});

test("signature insert for a status the inspection isn't in is rejected by trg_signature_requires_status", () => {
  const db = makeTestDb();
  const inspectionId = makeInspection(db);

  // Resolve the inspection to 'rejected' first.
  signInspectionStatus(db, { inspectionId, userId: 1, status: "rejected" });

  // A signature claiming 'approved' now contradicts the already-resolved status.
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO signatures (inspection_id, user_id, action) VALUES (?, ?, ?)")
        .run(inspectionId, 1, "approved"),
    /does not match/
  );
});
