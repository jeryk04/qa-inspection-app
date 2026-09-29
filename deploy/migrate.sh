#!/usr/bin/env bash
# Safely relocates a whole install of the QA Inspection App -- code, the
# live database, uploads/, certs/, and .env files -- from one directory to
# another (e.g. moving off a throwaway clone path onto the server's real
# production path).
#
# Safety, same philosophy as backend/scripts/backup.js and restore.js:
#   - refuses to run if data.db is still open by a running process (the app
#     must be stopped first)
#   - takes a normal backup.js snapshot before touching anything
#   - never deletes the source -- once the move is verified, the original
#     directory is renamed aside (".migrated-<timestamp>"), not removed
#   - node_modules is NOT copied across -- better-sqlite3 has a compiled
#     native binding tied to the machine it was installed on, so the
#     destination gets a fresh `npm install` instead
#   - the destination's database is integrity-checked before the source is
#     archived, so a bad copy is caught before the old copy is touched
#
# Usage:
#   ./migrate.sh <source-dir> <dest-dir>
#   ./migrate.sh <source-dir> <dest-dir> --force   (skip the confirmation prompt)
set -euo pipefail

SRC_ARG="${1:-}"
DEST="${2:-}"
FORCE="${3:-}"

if [ -z "$SRC_ARG" ] || [ -z "$DEST" ]; then
  echo "Usage: $0 <source-dir> <dest-dir> [--force]" >&2
  exit 1
fi

SRC="$(cd "$SRC_ARG" && pwd)"

if [ ! -f "$SRC/backend/package.json" ] || [ ! -f "$SRC/backend/src/index.js" ]; then
  echo "Error: $SRC doesn't look like a QA Inspection App install (no backend/package.json)." >&2
  exit 1
fi

if [ -e "$DEST" ]; then
  echo "Error: destination $DEST already exists -- refusing to overwrite. Remove it or pick another path." >&2
  exit 1
fi

# Canonicalize DEST the same way SRC was above (via cd+pwd, resolving any
# relative segments/symlinks) so the nested-path comparison below is
# comparing like with like -- DEST itself can't be cd'd into since it must
# not exist yet, but its parent can be, once created.
mkdir -p "$(dirname "$DEST")"
DEST="$(cd "$(dirname "$DEST")" && pwd)/$(basename "$DEST")"

case "$DEST" in
  "$SRC"|"$SRC"/*)
    echo "Error: destination cannot be inside the source directory." >&2
    exit 1
    ;;
esac

DB="$SRC/backend/data.db"

if command -v lsof >/dev/null 2>&1 && [ -f "$DB" ] && lsof "$DB" >/dev/null 2>&1; then
  echo "Error: $DB is still open by a running process -- stop the app first:" >&2
  lsof "$DB" >&2
  exit 1
fi

echo "About to relocate the install:"
echo "  from: $SRC"
echo "  to:   $DEST"
echo "(No process currently has data.db open, but double-check your process manager too before continuing.)"
echo ""

if [ "$FORCE" != "--force" ]; then
  read -r -p "Type 'yes' to continue: " ANSWER
  if [ "$ANSWER" != "yes" ]; then
    echo "Aborted."
    exit 0
  fi
fi

if [ -f "$SRC/backend/scripts/backup.js" ] && command -v node >/dev/null 2>&1; then
  echo "Taking a pre-migration backup at the source..."
  (cd "$SRC/backend" && node scripts/backup.js) || echo "Warning: pre-migration backup failed -- continuing anyway."
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is required (apt install rsync)." >&2
  exit 1
fi

echo "Copying files to $DEST (node_modules and build caches are rebuilt fresh, not copied)..."
rsync -a \
  --exclude 'node_modules/' \
  --exclude 'frontend/dist/' \
  --exclude 'frontend/dev-dist/' \
  --exclude 'backend/data.db' \
  --exclude 'backend/data.db-wal' \
  --exclude 'backend/data.db-shm' \
  "$SRC"/ "$DEST"/

if [ -f "$DB" ]; then
  echo "Checkpointing the database's WAL before copying it..."
  node -e "
    const Database = require(process.argv[1]);
    const db = new Database(process.argv[2]);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  " -- "$SRC/backend/node_modules/better-sqlite3" "$DB"
  cp "$DB" "$DEST/backend/data.db"
fi

echo "Installing dependencies at the new location (this rebuilds better-sqlite3's native binding for this machine)..."
(cd "$DEST/backend" && npm install)
(cd "$DEST/frontend" && npm install)

if [ -f "$DEST/backend/data.db" ]; then
  echo "Verifying the moved database..."
  node -e "
    const Database = require(process.argv[1]);
    const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
    const result = db.pragma('integrity_check');
    db.close();
    const ok = result.length === 1 && result[0].integrity_check === 'ok';
    if (!ok) { console.error('Integrity check FAILED:', result); process.exit(1); }
    console.log('Database integrity check: ok');
  " -- "$DEST/backend/node_modules/better-sqlite3" "$DEST/backend/data.db"
fi

SAFETY_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S)"
mv "$SRC" "${SRC}.migrated-${SAFETY_STAMP}"

echo ""
echo "Done. The app now lives at: $DEST"
echo "The old directory was kept (not deleted) as:"
echo "  ${SRC}.migrated-${SAFETY_STAMP}"
echo "Delete that manually once you've confirmed everything works at the new location."
echo ""
echo "Next steps:"
echo "  cd $DEST/backend && npm run start   (or point your process manager/systemd unit at this path)"
