const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "..", "data.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Creates the tables if they don't exist yet (idempotent, safe to run on every startup).
const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
db.exec(schema);

// SQLite's ALTER TABLE has no "ADD COLUMN IF NOT EXISTS" -- backfill columns
// added to schema.sql after a table already existed by checking for them here.
const balloonDrawingsColumns = db.prepare("PRAGMA table_info(balloon_drawings)").all();
if (!balloonDrawingsColumns.some((c) => c.name === "revision_label")) {
  db.exec("ALTER TABLE balloon_drawings ADD COLUMN revision_label TEXT");
}

const usersColumns = db.prepare("PRAGMA table_info(users)").all();
if (!usersColumns.some((c) => c.name === "role")) {
  db.exec(
    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'qc' CHECK (role IN ('operator','engineer','qc','admin'))"
  );
}

const balloonDrawingsColumnsForOps = db.prepare("PRAGMA table_info(balloon_drawings)").all();
if (!balloonDrawingsColumnsForOps.some((c) => c.name === "operation_id")) {
  db.exec("ALTER TABLE balloon_drawings ADD COLUMN operation_id INTEGER REFERENCES operations(id)");
}
if (!balloonDrawingsColumnsForOps.some((c) => c.name === "hundred_percent_inspection")) {
  db.exec("ALTER TABLE balloon_drawings ADD COLUMN hundred_percent_inspection INTEGER NOT NULL DEFAULT 0");
}

const inspectionsColumns = db.prepare("PRAGMA table_info(inspections)").all();
if (!inspectionsColumns.some((c) => c.name === "operation_id")) {
  db.exec("ALTER TABLE inspections ADD COLUMN operation_id INTEGER REFERENCES operations(id)");
}
if (!inspectionsColumns.some((c) => c.name === "conditional_reason")) {
  db.exec("ALTER TABLE inspections ADD COLUMN conditional_reason TEXT");
}
if (!inspectionsColumns.some((c) => c.name === "requires_in_process")) {
  db.exec("ALTER TABLE inspections ADD COLUMN requires_in_process INTEGER NOT NULL DEFAULT 0");
}
if (!inspectionsColumns.some((c) => c.name === "hundred_percent_inspection")) {
  db.exec("ALTER TABLE inspections ADD COLUMN hundred_percent_inspection INTEGER NOT NULL DEFAULT 0");
}

// These partial indexes depend on balloon_drawings.operation_id, just
// backfilled above on an existing database -- created here, not in
// schema.sql, since schema.sql's exec runs before this guarded migration.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_final_drawing_version ON balloon_drawings(part_id, version) WHERE operation_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_template_version ON balloon_drawings(operation_id, version) WHERE operation_id IS NOT NULL;
`);

// operations.scope (Set-up vs In-Process, see schema.sql's comment) can't be
// backfilled with a plain ALTER TABLE ADD COLUMN like the columns above --
// it also needs the table's UNIQUE constraint to grow from (part_id, name)
// to (part_id, scope, name), and SQLite can't ALTER an inline table
// constraint. Rebuild the table instead: every existing row defaults to
// 'setup' (matching schema.sql's column default), which is safe -- checked
// at migration-authoring time that zero existing operations had any
// Set-up/In-Process inspection recorded against them yet. balloon_drawings.
// operation_id / inspections.operation_id keep resolving correctly since
// they reference the table by name and every row keeps its original id.
// PRAGMA foreign_keys can't be toggled inside a transaction, so this runs
// as plain sequential statements, not db.transaction().
const operationsColumns = db.prepare("PRAGMA table_info(operations)").all();
if (!operationsColumns.some((c) => c.name === "scope")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE operations_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id     INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      scope       TEXT NOT NULL DEFAULT 'setup' CHECK (scope IN ('setup', 'in_process')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(part_id, scope, name)
    );
    INSERT INTO operations_new (id, part_id, name, scope, created_at)
      SELECT id, part_id, name, 'setup', created_at FROM operations;
    DROP TABLE operations;
    ALTER TABLE operations_new RENAME TO operations;
    CREATE INDEX IF NOT EXISTS idx_operations_part ON operations(part_id);
    PRAGMA foreign_keys = ON;
  `);
}

// A second, separate split: 'in_process' on its own still let QC's own
// "In-Process Inspection" entry point (Home.jsx) and the Operator's collide
// on the exact same operations, since both used to route through the same
// scope value -- see schema.sql's updated comment. Splits it into
// 'in_process_operator' / 'in_process_qc'; every existing 'in_process' row
// (there were none at migration-authoring time, so this is a no-op in
// practice, but backfills forward to 'in_process_operator' if any exist) is
// remapped to keep the Operator's existing work where it was. Same
// table-rebuild reasoning as above -- CHECK constraints can't be ALTERed.
// Guarded by inspecting the table's actual stored CHECK (PRAGMA table_info
// doesn't expose it) rather than by column presence, since `scope` already
// exists from the migration above.
const operationsTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'operations'").get()?.sql || "";
if (!operationsTableSql.includes("in_process_operator")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE operations_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id     INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      scope       TEXT NOT NULL DEFAULT 'setup' CHECK (scope IN ('setup', 'in_process_operator', 'in_process_qc')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(part_id, scope, name)
    );
    INSERT INTO operations_new (id, part_id, name, scope, created_at)
      SELECT id, part_id, name, CASE WHEN scope = 'in_process' THEN 'in_process_operator' ELSE scope END, created_at FROM operations;
    DROP TABLE operations;
    ALTER TABLE operations_new RENAME TO operations;
    CREATE INDEX IF NOT EXISTS idx_operations_part ON operations(part_id);
    PRAGMA foreign_keys = ON;
  `);
}

// must_change_password: forces a one-time password change on next login.
// Backfilled true for every existing account still on the shared bulk-
// import default ("Pass123 for all users") -- checked by actually
// comparing each hash rather than assuming, so an account that already
// had its password changed since the import isn't re-flagged.
const usersColumnsForPasswordFlag = db.prepare("PRAGMA table_info(users)").all();
if (!usersColumnsForPasswordFlag.some((c) => c.name === "must_change_password")) {
  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  const allUsers = db.prepare("SELECT id, password_hash FROM users").all();
  const flagUser = db.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?");
  allUsers.forEach((u) => {
    if (bcrypt.compareSync("Pass123", u.password_hash)) flagUser.run(u.id);
  });
}

// last_login: set on every successful sign-in (see routes/auth.js), shown in
// the User Management table. NULL until a user's first login after this
// column existed -- surfaced as "Never" in the UI, not backfilled.
const usersColumnsForLastLogin = db.prepare("PRAGMA table_info(users)").all();
if (!usersColumnsForLastLogin.some((c) => c.name === "last_login")) {
  db.exec("ALTER TABLE users ADD COLUMN last_login TEXT");
}

// supervisor: a new role that can delete an already-saved inspection (like
// admin) without the rest of admin's access (user management, etc.) --
// added to the role CHECK constraint, which -- same as operations.scope
// above -- can't be ALTERed in place, so the table is rebuilt. Every other
// table referencing users(id) (signatures, audit_log, user_clients,
// deleted_items, ...) keeps resolving correctly since every row keeps its
// original id. Guarded by inspecting the table's actual stored CHECK
// (PRAGMA table_info doesn't expose it), same as the operations migrations.
const usersTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || "";
if (!usersTableSql.includes("supervisor")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE users_new (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      username              TEXT NOT NULL UNIQUE,
      password_hash         TEXT NOT NULL,
      full_name             TEXT NOT NULL,
      role                  TEXT NOT NULL DEFAULT 'qc' CHECK (role IN ('operator','engineer','qc','supervisor','admin')),
      active                INTEGER NOT NULL DEFAULT 1,
      must_change_password  INTEGER NOT NULL DEFAULT 0,
      last_login            TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users_new (id, username, password_hash, full_name, role, active, must_change_password, last_login, created_at)
      SELECT id, username, password_hash, full_name, role, active, must_change_password, last_login, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    PRAGMA foreign_keys = ON;
  `);
}

// email: optional contact field, self-service (auth.js's PUT /email) or
// admin-set (admin.js). Not used for login (username + PIN stays the only
// credential, see CLAUDE.md) and not unique -- just a place to record one if
// the account has one, for whatever later needs it (e.g. notifications).
const usersColumnsForEmail = db.prepare("PRAGMA table_info(users)").all();
if (!usersColumnsForEmail.some((c) => c.name === "email")) {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT");
}

// is_check_column: explicit flag for whether a Find# column captures as a
// pass/fail OK/Not-OK check instead of a numeric measurement, decoupled from
// whether it happens to have Max/Mean/Min spec values recorded (a check
// column can still carry a documented reference spec -- e.g. a Go/No-Go
// gauge's nominal size -- without switching to numeric capture). Backfilled
// true for every existing point with no spec at all, since "all three specs
// blank" was the only signal this used to be inferred from (see
// frontend/src/lib/passfail.js's isSpecless) -- so every point already
// behaving as a check column keeps behaving as one.
const balloonPointsColumns = db.prepare("PRAGMA table_info(balloon_points)").all();
if (!balloonPointsColumns.some((c) => c.name === "is_check_column")) {
  db.exec("ALTER TABLE balloon_points ADD COLUMN is_check_column INTEGER NOT NULL DEFAULT 0");
  db.exec(
    "UPDATE balloon_points SET is_check_column = 1 WHERE max_spec IS NULL AND min_spec IS NULL AND mean_value IS NULL"
  );
}

// is_reference: reference-dimension flag, display-only (see schema.sql).
// Defaults to 0 for every existing point -- nothing was ever saved as a
// reference before, since "(5.18)" used to fail to parse and save as blank.
if (!balloonPointsColumns.some((c) => c.name === "is_reference")) {
  db.exec("ALTER TABLE balloon_points ADD COLUMN is_reference INTEGER NOT NULL DEFAULT 0");
}

// machine_log_mode: In-Process only, same template->inspection inheritance
// as hundred_percent_inspection (see schema.sql). Defaults to 0/off for
// every existing drawing and inspection -- nothing changes for anyone not
// explicitly opting in on their Data Sheet Template.
const balloonDrawingsColumnsForMachineLog = db.prepare("PRAGMA table_info(balloon_drawings)").all();
if (!balloonDrawingsColumnsForMachineLog.some((c) => c.name === "machine_log_mode")) {
  db.exec("ALTER TABLE balloon_drawings ADD COLUMN machine_log_mode INTEGER NOT NULL DEFAULT 0");
}
const inspectionsColumnsForMachineLog = db.prepare("PRAGMA table_info(inspections)").all();
if (!inspectionsColumnsForMachineLog.some((c) => c.name === "machine_log_mode")) {
  db.exec("ALTER TABLE inspections ADD COLUMN machine_log_mode INTEGER NOT NULL DEFAULT 0");
}

// A third, separate scope split: 'samples' -- a new, fully independent
// operations list (own Data Sheet Templates, shares nothing with Set-up or
// either In-Process bucket) for the new "Samples" inspection type, used to
// evaluate a brand-new customer or part before it's a qualified production
// relationship. Same table-rebuild reasoning as the two migrations above --
// CHECK constraints can't be ALTERed. Guarded by inspecting the table's
// actual stored CHECK (PRAGMA table_info doesn't expose it), same as those.
const operationsTableSqlForSamples = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'operations'").get()?.sql || "";
if (!operationsTableSqlForSamples.includes("'samples'")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE operations_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id     INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      scope       TEXT NOT NULL DEFAULT 'setup' CHECK (scope IN ('setup', 'in_process_operator', 'in_process_qc', 'samples')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(part_id, scope, name)
    );
    INSERT INTO operations_new (id, part_id, name, scope, created_at)
      SELECT id, part_id, name, scope, created_at FROM operations;
    DROP TABLE operations;
    ALTER TABLE operations_new RENAME TO operations;
    CREATE INDEX IF NOT EXISTS idx_operations_part ON operations(part_id);
    PRAGMA foreign_keys = ON;
  `);
}

// inspections.type gains 'samples' -- the new QC-only inspection type above
// (Customer -> Part -> Operations -> Data Sheet, same shape as Set-up).
// Same table-rebuild reasoning as every migration above -- CHECK constraints
// can't be ALTERed. Guarded by inspecting the table's actual stored CHECK.
//
// This one needs an extra step the others didn't: ALTER TABLE...RENAME TO
// automatically rewrites references to the renamed table inside OTHER
// triggers' bodies, and doing that rewrite chokes (SqliteError "no such
// table: main.inspections") on trg_signature_requires_status -- it's
// defined ON signatures, not inspections, but its WHEN clause subquery
// references inspections by name, and only once a signatures row actually
// exists to make that trigger "real" to the rename's fixup pass (verified
// by reproducing this exact failure against a seeded in-memory DB before
// writing this). So both signing triggers are dropped first and recreated
// after the rename, instead of just letting DROP TABLE take
// trg_status_requires_signature (the one actually defined ON inspections)
// down on its own and recreating only that one.
const inspectionsTableSqlForSamples = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inspections'").get()?.sql || "";
if (!inspectionsTableSqlForSamples.includes("'samples'")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TRIGGER IF EXISTS trg_status_requires_signature;
    DROP TRIGGER IF EXISTS trg_signature_requires_status;
    CREATE TABLE inspections_new (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id             INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
      drawing_id          INTEGER REFERENCES balloon_drawings(id),
      type                TEXT NOT NULL CHECK (type IN ('quote', 'incoming', 'setup', 'in_process', 'final', 'other', 'samples')),
      inspector           TEXT,
      date                TEXT NOT NULL DEFAULT (datetime('now')),
      status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'approved', 'rejected')),
      notes               TEXT,
      customer            TEXT,
      heat                TEXT,
      quantity            INTEGER,
      supplier            TEXT,
      po_number           TEXT,
      customer_po_number  TEXT,
      operation           TEXT,
      operation_id        INTEGER REFERENCES operations(id),
      job_number          TEXT,
      sampling_plan_n     INTEGER,
      sampling_plan_c     INTEGER,
      lot_disposition     TEXT,
      conditional_reason  TEXT,
      requires_in_process INTEGER NOT NULL DEFAULT 0,
      hundred_percent_inspection INTEGER NOT NULL DEFAULT 0,
      machine_log_mode    INTEGER NOT NULL DEFAULT 0,
      created_by          INTEGER REFERENCES users(id),
      updated_by          INTEGER REFERENCES users(id)
    );
    INSERT INTO inspections_new
      (id, part_id, drawing_id, type, inspector, date, status, notes, customer, heat, quantity, supplier,
       po_number, customer_po_number, operation, operation_id, job_number, sampling_plan_n, sampling_plan_c,
       lot_disposition, conditional_reason, requires_in_process, hundred_percent_inspection, machine_log_mode,
       created_by, updated_by)
      SELECT
        id, part_id, drawing_id, type, inspector, date, status, notes, customer, heat, quantity, supplier,
        po_number, customer_po_number, operation, operation_id, job_number, sampling_plan_n, sampling_plan_c,
        lot_disposition, conditional_reason, requires_in_process, hundred_percent_inspection, machine_log_mode,
        created_by, updated_by
      FROM inspections;
    DROP TABLE inspections;
    ALTER TABLE inspections_new RENAME TO inspections;
    CREATE INDEX IF NOT EXISTS idx_inspections_part ON inspections(part_id);
    CREATE TRIGGER trg_status_requires_signature
    BEFORE UPDATE OF status ON inspections
    WHEN NEW.status IN ('approved', 'rejected')
      AND NOT EXISTS (
        SELECT 1 FROM signatures WHERE inspection_id = NEW.id AND action = NEW.status
      )
    BEGIN
      SELECT RAISE(ABORT, 'inspections.status cannot be set to approved/rejected without a matching signature');
    END;
    CREATE TRIGGER trg_signature_requires_status
    BEFORE INSERT ON signatures
    WHEN (SELECT status FROM inspections WHERE id = NEW.inspection_id) NOT IN ('in_progress', NEW.action)
    BEGIN
      SELECT RAISE(ABORT, 'signatures.action does not match the inspection''s current status');
    END;
    PRAGMA foreign_keys = ON;
  `);
}

module.exports = db;
