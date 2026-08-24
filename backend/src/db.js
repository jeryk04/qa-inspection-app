const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

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

const inspectionsColumns = db.prepare("PRAGMA table_info(inspections)").all();
if (!inspectionsColumns.some((c) => c.name === "operation_id")) {
  db.exec("ALTER TABLE inspections ADD COLUMN operation_id INTEGER REFERENCES operations(id)");
}
if (!inspectionsColumns.some((c) => c.name === "conditional_reason")) {
  db.exec("ALTER TABLE inspections ADD COLUMN conditional_reason TEXT");
}

// These partial indexes depend on balloon_drawings.operation_id, just
// backfilled above on an existing database -- created here, not in
// schema.sql, since schema.sql's exec runs before this guarded migration.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_final_drawing_version ON balloon_drawings(part_id, version) WHERE operation_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_template_version ON balloon_drawings(operation_id, version) WHERE operation_id IS NOT NULL;
`);

module.exports = db;
