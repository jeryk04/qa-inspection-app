# Project Context — QA Inspection App

## What this is
A quality control app that digitizes 4 types of inspection: Incoming,
Set-up, In-Process, and Final Inspection. It replaces paper/Excel
inspection sheets. Measurements are captured by "balloon" number (a
numbered point on the part's technical drawing) and stored organized by
client and part number.

## Current status / priority
We're in **Phase 1 (MVP)**: **Final Inspection only**. Don't implement
Incoming/Set-up/In-Process yet unless explicitly asked — the data model
already accounts for them (the `type` column on `inspections`) but the
UI flow should only cover Final Inspection for now.

See `docs/PLAN.md` for the full phase plan and scope detail.

## Data model (already defined in backend/src/schema.sql)
- `clients` — the company's clients
- `parts` — parts, each associated with a client
- `balloon_drawings` — the technical drawing image for a part
- `balloon_points` — each numbered point on the drawing, with its spec/tolerance
- `inspections` — a performed inspection (type, part, date, inspector, status)
- `measurements` — the measured value for each balloon point in an inspection

## Repo conventions
- Backend: Express, REST routes under `/api/...`, one route file per entity in `backend/src/routes/`.
- Database: SQLite via `better-sqlite3`, synchronous queries (no async/await needed for the DB).
- Frontend: React + Vite, functional components with hooks, no Redux (state is simple for now).
- Language: everything — table/column names, code, UI text — is in English.
- Don't add MIE Trak Pro integration yet — it's planned for Phase 3.

## How to run the project
```bash
# backend
cd backend && npm install && npm run dev   # http://localhost:3001

# frontend (separate terminal)
cd frontend && npm install && npm run dev  # http://localhost:5173
```

## Suggested next task
See the MVP task breakdown in `docs/PLAN.md`, section 7. Go task by
task, testing each one before moving to the next.
