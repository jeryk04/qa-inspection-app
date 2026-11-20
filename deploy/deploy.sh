#!/usr/bin/env bash
# Deploys a new version of the QA Inspection App on this server: backs up
# the database, pulls the latest code, installs dependencies, builds the
# frontend, and restarts the backend -- WITHOUT touching backend/data.db,
# backend/uploads/, or any .env file. All three are gitignored, so a pull
# never touches them; every existing inspection stays exactly where it was.
# Schema changes ship as additive, idempotent migrations in backend/src/db.js
# and run automatically when the backend starts.
#
# Production layout (G&J server, qc.gjsteel.com):
#   - the install directory is owned by a dedicated service user; this script
#     runs as root (sudo) and does every git/npm step AS THAT USER, so file
#     ownership never drifts and git never complains about "dubious ownership"
#   - systemd runs only the backend (qa-inspection-backend, https on PORT)
#   - nginx serves frontend/dist/ and proxies /api + /uploads to the backend,
#     so there is no frontend service. frontend/.env must hold
#     VITE_API_URL=/api so the build calls the API on its own origin.
#   - an optional qa-inspection-frontend service (the old `vite preview`
#     setup) is still restarted if it exists
#
# The build goes to dist.new/ and is swapped in only once it succeeds, so a
# failed build leaves the running site untouched and a good one replaces it
# in one rename.
#
# Usage (as root, or it re-runs itself under sudo):
#   deploy.sh              pull the current branch's upstream (fast-forward only)
#   deploy.sh <git-ref>    switch to this branch/tag/commit first
# QA_APP_DIR overrides the install directory (default: the repo this script
# sits in, else /opt/qa-inspection-app).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E "$0" "$@"
fi

SELF_REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
if [ -n "${QA_APP_DIR:-}" ]; then
  APP_DIR="$QA_APP_DIR"
elif [ -f "$SELF_REPO/backend/src/index.js" ]; then
  APP_DIR="$SELF_REPO"
else
  APP_DIR=/opt/qa-inspection-app
fi
cd "$APP_DIR"

if [ ! -f backend/package.json ] || [ ! -f backend/src/index.js ]; then
  echo "Error: $APP_DIR doesn't look like the QA Inspection App repo root." >&2
  exit 1
fi

OWNER="$(stat -c %U "$APP_DIR")"
OWNER_HOME="$(getent passwd "$OWNER" | cut -d: -f6)"
as_owner() { sudo -u "$OWNER" env HOME="$OWNER_HOME" "$@"; }

BACKEND_UNIT=qa-inspection-backend
FRONTEND_UNIT=qa-inspection-frontend
BACKEND_PORT="$(grep -E '^PORT=' backend/.env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)"
BACKEND_PORT="${BACKEND_PORT:-3001}"

if [ -n "$(as_owner git status --porcelain)" ]; then
  echo "Error: the working tree has uncommitted/local changes -- refusing to deploy." >&2
  echo "This server's checkout should always be a clean mirror of a git ref; if" >&2
  echo "something was edited here directly, commit or discard it first." >&2
  as_owner git status --short >&2
  exit 1
fi

if ! grep -qE '^VITE_API_URL=' frontend/.env 2>/dev/null && ! systemctl cat "$FRONTEND_UNIT" >/dev/null 2>&1; then
  echo "Error: frontend/.env has no VITE_API_URL and there is no $FRONTEND_UNIT service." >&2
  echo "Behind nginx the build must call its own origin: echo 'VITE_API_URL=/api' > frontend/.env" >&2
  exit 1
fi

PREV="$(as_owner git rev-parse --short HEAD)"
REF="${1:-}"

echo "==> Backing up the database before touching anything..."
(cd backend && as_owner node scripts/backup.js)

echo "==> Fetching latest code..."
as_owner git fetch --prune origin
if [ -n "$REF" ]; then
  if as_owner git rev-parse --verify --quiet "origin/$REF" >/dev/null; then
    as_owner git checkout -B "$REF" "origin/$REF"   # a branch: track origin's copy
  else
    as_owner git checkout --detach "$REF"           # a tag or commit
  fi
else
  as_owner git pull --ff-only
fi
echo "    $PREV -> $(as_owner git rev-parse --short HEAD) ($(as_owner git log -1 --format=%s))"

echo "==> Installing backend dependencies..."
(cd backend && as_owner npm ci --no-audit --no-fund)

echo "==> Installing frontend dependencies and building..."
(cd frontend && as_owner npm ci --no-audit --no-fund \
  && as_owner rm -rf dist.new \
  && as_owner npx vite build --outDir dist.new --emptyOutDir)
if [ ! -f frontend/dist.new/index.html ]; then
  echo "Error: frontend build produced no index.html -- the running site was left as it was." >&2
  exit 1
fi

echo "==> Restarting backend service..."
systemctl restart "$BACKEND_UNIT"

echo "==> Waiting for backend health check..."
healthy=""
for _ in $(seq 1 20); do
  if curl -sk -m 2 "https://localhost:${BACKEND_PORT}/api/health" 2>/dev/null | grep -q '"ok":true'; then
    healthy=1
    break
  fi
  sleep 1
done

if [ -z "$healthy" ]; then
  echo "" >&2
  echo "!! Backend did not respond healthy after restart. The new frontend was NOT swapped in." >&2
  echo "!! Check logs:  journalctl -u $BACKEND_UNIT -n 50 --no-pager" >&2
  echo "!! Roll back the code (data is untouched beyond additive migrations):" >&2
  echo "!!   sudo -u $OWNER git -C $APP_DIR checkout $PREV && sudo systemctl restart $BACKEND_UNIT" >&2
  exit 1
fi
echo "    backend healthy."

echo "==> Swapping in the new frontend build..."
(cd frontend && as_owner rm -rf dist.old && { [ -d dist ] && as_owner mv dist dist.old || true; } \
  && as_owner mv dist.new dist && as_owner rm -rf dist.old)

if systemctl cat "$FRONTEND_UNIT" >/dev/null 2>&1; then
  echo "==> Restarting frontend service..."
  systemctl restart "$FRONTEND_UNIT"
else
  echo "    (frontend is served by nginx from frontend/dist -- nothing to restart)"
fi

echo ""
echo "Deploy complete. $(as_owner git rev-parse --short HEAD) is now live."
echo "  journalctl -u $BACKEND_UNIT -f"
