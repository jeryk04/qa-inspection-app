#!/usr/bin/env bash
# Deploys a new version of the QA Inspection App on this server: backs up
# the database, pulls the latest code, installs dependencies, builds the
# frontend, and restarts the systemd services -- WITHOUT touching
# backend/data.db, backend/uploads/, or any .env file. All three are
# gitignored, so `git pull` never touches them; every existing inspection
# stays exactly where it was. If a fix needs a schema change, ship it as an
# additive, idempotent migration in backend/src/db.js (same pattern as the
# existing migrations there, guarded by checking whether the change already
# applied) -- it runs automatically the next time the backend starts, against
# the live database, and never drops or rewrites existing rows.
#
# One-time setup before the first run:
#   1. Edit User=/WorkingDirectory=/ExecStart= in both files under
#      deploy/systemd/, then:
#        sudo cp deploy/systemd/*.service /etc/systemd/system/
#        sudo systemctl daemon-reload
#        sudo systemctl enable qa-inspection-backend qa-inspection-frontend
#   2. Create backend/.env with a real PORT and a real random JWT_SECRET
#      (see backend/.env.example -- do NOT ship the placeholder value).
#      Create frontend/.env too if VITE_API_URL needs to be explicit.
#   3. (cd backend && npm install) once, so node_modules exists before the
#      backend service starts for the first time.
#   4. This script calls `sudo systemctl restart ...` -- either run the
#      whole script with sudo, or grant the deploy user passwordless sudo
#      for just those two commands (visudo):
#        deployuser ALL=(root) NOPASSWD: /usr/bin/systemctl restart qa-inspection-backend, /usr/bin/systemctl restart qa-inspection-frontend
#   5. Consider a daily cron for backend/scripts/backup.js -- suggested
#      crontab line is in that file's own header comment.
#
# Usage:
#   ./deploy/deploy.sh            deploy whatever the current branch's
#                                  upstream has (plain `git pull`)
#   ./deploy/deploy.sh <git-ref>  checkout and deploy this branch/tag first
set -euo pipefail

cd "$(dirname "$0")/.."  # repo root

if [ ! -f backend/package.json ] || [ ! -f backend/src/index.js ]; then
  echo "Error: this doesn't look like the QA Inspection App repo root." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: the working tree has uncommitted/local changes -- refusing to deploy." >&2
  echo "This server's checkout should always be a clean mirror of a git ref; if" >&2
  echo "something was edited here directly, commit or discard it first." >&2
  git status --short >&2
  exit 1
fi

REF="${1:-}"
BACKEND_PORT="${PORT:-3001}"  # override by exporting PORT if backend/.env uses a non-default one

echo "==> Backing up the database before touching anything..."
(cd backend && node scripts/backup.js)

echo "==> Fetching latest code..."
git fetch origin
if [ -n "$REF" ]; then
  git checkout "$REF"
  git pull origin "$REF"
else
  git pull
fi
echo "    now at: $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"

echo "==> Installing backend dependencies..."
(cd backend && npm install)

echo "==> Installing frontend dependencies and building..."
(cd frontend && npm install && npm run build)

echo "==> Restarting backend service..."
sudo systemctl restart qa-inspection-backend

echo "==> Waiting for backend health check..."
healthy=""
for _ in $(seq 1 15); do
  if curl -sk -m 2 "https://localhost:${BACKEND_PORT}/api/health" 2>/dev/null | grep -q '"ok":true'; then
    healthy=1
    break
  fi
  sleep 1
done

if [ -z "$healthy" ]; then
  echo "" >&2
  echo "!! Backend did not respond healthy after restart." >&2
  echo "!! Check logs:  journalctl -u qa-inspection-backend -n 50 --no-pager" >&2
  echo "!! The database was NOT modified by this deploy beyond your own" >&2
  echo "!! migrations (if any) -- fix the code and rerun this script, or roll" >&2
  echo "!! back the code with:" >&2
  echo "!!   git checkout <previous-known-good-commit>" >&2
  echo "!!   sudo systemctl restart qa-inspection-backend" >&2
  echo "!! Either way, all inspection data recorded so far is untouched." >&2
  exit 1
fi
echo "    backend healthy."

echo "==> Restarting frontend service..."
sudo systemctl restart qa-inspection-frontend

echo ""
echo "Deploy complete. $(git rev-parse --short HEAD) is now live."
echo "  journalctl -u qa-inspection-backend -f"
echo "  journalctl -u qa-inspection-frontend -f"
