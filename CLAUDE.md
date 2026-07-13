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
This mirrors the company's real paper Data Sheet: each inspection is a
grid of **samples (sample_number) × balloon points (Find #)**, not a
single value per point.

- `clients` — the company's clients
- `parts` — parts, each associated with a client
- `balloon_drawings` — the technical drawing image for a part
- `balloon_points` — each numbered "Find #" on the drawing, with
  `max_spec` / `min_spec` / `mean_value` (matches the Max Spec / Min
  Spec / MEAN rows on the paper sheet)
- `inspections` — a performed inspection: `type` (quote/incoming/setup/
  in_process/final/other — Phase 1 UI only creates `final`), part,
  date, inspector, status, plus the full paper header: `customer`,
  `heat`, `quantity`, `supplier`, `po_number`, `customer_po_number`,
  `operation`, `job_number`, `sampling_plan_n`, `sampling_plan_c`,
  `lot_disposition`
- `measurements` — one cell of the sample × Find# grid: `balloon_point_id`
  + `sample_number` + measured value + computed within-tolerance flag
  (unique per inspection+point+sample)

The inspection sheet can be exported as a PDF that visually replicates
the paper Data Sheet (`GET /api/inspections/:id/pdf`, built with
`pdfkit` — see `backend/src/pdf/inspectionSheet.js`).

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
