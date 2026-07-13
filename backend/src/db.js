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

module.exports = db;
