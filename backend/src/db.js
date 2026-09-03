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

module.exports = db;
