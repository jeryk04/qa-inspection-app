// Backs up data.db (via better-sqlite3's online backup API -- safe to run
// while the server is live, unlike a plain file copy which can miss rows
// still sitting in data.db-wal since the db is opened in WAL mode, see
// db.js) plus the uploads/ folder, into one timestamped directory. Verifies
// the copy isn't corrupt before calling it done, then prunes old backups
// beyond the retention window.
//
// Usage: node scripts/backup.js   (or `npm run backup` from backend/)
//
// Suggested crontab line once deployed (daily at 2am):
//   0 2 * * * cd /path/to/qa-inspection-app/backend && /usr/bin/node scripts/backup.js >> backups/backup.log 2>&1
//
// BACKUP_DIR defaults to backend/backups/ -- that's still the same disk as
// data.db itself, so it protects against a bad delete/migration but NOT
// against that disk failing. Point BACKUP_DIR at a separate volume or
// mounted network share once one exists in the deployment.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DATA_DB_PATH || path.join(__dirname, "..", "data.db");
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups");
const RETENTION = Number(process.env.BACKUP_RETENTION || 14);

function timestamp() {
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
}

// Keeps the most recent RETENTION backups, deletes the rest -- backup
// folders are named with a sortable ISO timestamp, so a plain string sort
// is enough to find the oldest ones.
function prune() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const entries = fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const toRemove = entries.slice(0, Math.max(0, entries.length - RETENTION));
  toRemove.forEach((name) => {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });
    console.log(`  pruned old backup: ${name}`);
  });
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database found at ${DB_PATH} -- nothing to back up.`);
    process.exit(1);
  }

  const dest = path.join(BACKUP_DIR, timestamp());
  fs.mkdirSync(dest, { recursive: true });
  const destDb = path.join(dest, "data.db");

  const source = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  await source.backup(destDb);
  source.close();

  // A backup that can't actually be opened/read is worse than no backup --
  // it looks like protection while quietly providing none. Fail loudly
  // (non-zero exit, so cron surfaces it) rather than leave a corrupt copy
  // sitting there looking fine.
  const check = new Database(destDb, { readonly: true, fileMustExist: true });
  const result = check.pragma("integrity_check");
  check.close();
  const ok = result.length === 1 && result[0].integrity_check === "ok";
  if (!ok) {
    fs.rmSync(dest, { recursive: true, force: true });
    console.error("Backup integrity check failed -- backup discarded:", result);
    process.exit(1);
  }

  let uploadCount = 0;
  if (fs.existsSync(UPLOADS_DIR)) {
    fs.cpSync(UPLOADS_DIR, path.join(dest, "uploads"), { recursive: true });
    uploadCount = fs.readdirSync(UPLOADS_DIR).length;
  }

  console.log(`Backup complete: ${dest}`);
  console.log(`  data.db verified ok, ${uploadCount} item(s) in uploads/`);

  prune();
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
