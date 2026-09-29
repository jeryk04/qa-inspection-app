// Restores data.db + uploads/ from a backup made by scripts/backup.js.
//
// The backend server MUST be stopped first -- this replaces the live files
// out from under a running better-sqlite3 connection, which is unsafe
// otherwise.
//
// Usage:
//   node scripts/restore.js --latest
//   node scripts/restore.js 2026-09-04T02-00-00
//   node scripts/restore.js --latest --force   (skip the confirmation prompt)
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DB_PATH = process.env.DATA_DB_PATH || path.join(__dirname, "..", "data.db");
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups");

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    })
  );
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const useLatest = args.includes("--latest");
  const named = args.find((a) => !a.startsWith("--"));

  const backups = listBackups();
  if (backups.length === 0) {
    console.error(`No backups found in ${BACKUP_DIR}.`);
    process.exit(1);
  }

  const chosen = useLatest ? backups[backups.length - 1] : named;
  if (!chosen || !backups.includes(chosen)) {
    console.error(`Specify a backup to restore (or --latest). Available:\n  ${backups.join("\n  ")}`);
    process.exit(1);
  }

  const src = path.join(BACKUP_DIR, chosen);
  const srcDb = path.join(src, "data.db");
  if (!fs.existsSync(srcDb)) {
    console.error(`${src} has no data.db -- not a valid backup.`);
    process.exit(1);
  }

  console.log(`This will REPLACE the live database and uploads with backup "${chosen}".`);
  console.log(`Make sure the backend server is stopped first.`);
  if (!force) {
    const answer = await confirm("Type 'yes' to continue: ");
    if (answer !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  // Move the current live db/uploads aside instead of deleting them
  // outright -- same instinct as the hand-made pre-migration .bak files
  // already in this folder, so a bad or premature restore is itself
  // recoverable rather than a second data-loss incident.
  const safetyStamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  if (fs.existsSync(DB_PATH)) {
    fs.renameSync(DB_PATH, `${DB_PATH}.pre-restore-${safetyStamp}.bak`);
  }
  ["-wal", "-shm"].forEach((suffix) => {
    const p = `${DB_PATH}${suffix}`;
    if (fs.existsSync(p)) fs.rmSync(p);
  });

  fs.copyFileSync(srcDb, DB_PATH);

  if (fs.existsSync(path.join(src, "uploads"))) {
    if (fs.existsSync(UPLOADS_DIR)) {
      fs.renameSync(UPLOADS_DIR, `${UPLOADS_DIR}.pre-restore-${safetyStamp}`);
    }
    fs.cpSync(path.join(src, "uploads"), UPLOADS_DIR, { recursive: true });
  }

  console.log(`Restored from "${chosen}".`);
  console.log(`Previous live data saved alongside with a "pre-restore-${safetyStamp}" suffix, in case this was a mistake.`);
  console.log(`Start the backend server again now.`);
}

main().catch((err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});
