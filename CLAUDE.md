# Project Context — QA Inspection App

## What this is
A quality control app that digitizes 4 types of inspection: Incoming,
Set-up, In-Process, and Final Inspection. It replaces paper/Excel
inspection sheets. Measurements are captured by "balloon" number (a
numbered point on the part's technical drawing) and stored organized by
client and part number.

## Current status / priority
Phase 2 (Inspection Expansion) is done — all 4 inspection types (Final,
Set-up, In-Process, Incoming) have working UI flows, and as of 2026-09-03
the app is live for real production inspections across every department
(operators, QC, engineers). Incoming Inspection doesn't get its own new
UI shape — it reuses the same per-part Parts → InspectionCapture flow as
Final, just entered through a different picker (`Home.jsx`'s "Incoming
Inspection" card → `/incoming`) that organizes clients into 3 categories
(Material/Subcomponent/Subcontractor) matching the real source folders on
disk, instead of the normal customer list. See `frontend/src/lib/
incoming.js` for the folder-to-category mapping and `IncomingInspection.jsx`
/ `IncomingFolders.jsx` for the picker UI.

Next up: keep the app stable for real use; once enough real inspection
data has accumulated, resume the Engineer Dashboard analytics work
(per-part Xbar-style batch charts, Cpk, control limits — see `frontend/
src/components/charts/RunChart.jsx` — are built but were only exercised
against seeded demo data so far).

Final Inspection is one Data Sheet per part (the part's default,
`operation_id IS NULL` drawing bucket). In-Process and Set-up Inspection
are both scoped per manufacturing **operation** on the part (e.g.
"Bending", "Groove" — see the `operations` table, `frontend/src/pages/
OperationsList.jsx` / `OperationDetail.jsx`). There are **three fully
independent** operation lists — and independent Data Sheet Templates —
per part, via `operations.scope`: `'setup'` (QC), `'in_process_operator'`
(the Operator's own work), and `'in_process_qc'` (QC has its own separate
"In-Process Inspection" entry point on `Home.jsx` too, e.g. to cover for
an absent operator). All three can track the same real physical step
(e.g. all three could have a "Bending"), but as separate operation rows
that share nothing — not specs, not drawings, not history — and deleting
one's operation never touches either of the other two's. Only the
customer/part number has to match across them, nothing else. Note
`inspections.type` itself stays a plain `'setup'`/`'in_process'` paper-
form category regardless of which of the two `in_process_*` scopes
created it — the split is purely about which operation/template list was
used, not a new inspection type. There's only one `?type=in_process` URL
(`OperationsList.jsx` derives the actual scope from the viewer's
`effectiveRole`, not the URL, since QC's and the Operator's home cards
both route to the same place). (Earlier versions of this app had every
audience share one operation+template per part — that turned out to be
wrong and caused two real incidents: QC lost its Set-up operations
because an Operator-focused cleanup deleted the *shared* row, and then
QC's own In-Process operations turned out to still be colliding with the
Operator's after the first fix, since both used one `'in_process'` value.)
Operators only ever do In-Process; Set-up is QC-only (see `Home.jsx`'s
per-role cards) — QC's own In-Process card is a secondary, separate path.

See `docs/PLAN.md` for the full phase plan and scope detail (its Phase 1
"Out of scope" list is stale relative to this section).

## Data model (already defined in backend/src/schema.sql)
This mirrors the company's real paper Data Sheet: each inspection is a
grid of **samples (sample_number) × balloon points (Find #)**, not a
single value per point.

- `users` — login accounts: `role` (operator/engineer/qc/admin), `active`
  (deactivate, don't hard-delete, once a user has real audit history),
  `must_change_password` (forces a one-time password-change prompt on next
  login — set on every admin-created/reset password, see `backend/src/
  routes/auth.js`'s `PUT /password` and `App.jsx`'s `RequireAuth`)
- `clients` — the company's clients
- `parts` — parts, each associated with a client
- `balloon_drawings` — the technical drawing image for a part
- `balloon_points` — each numbered "Find #" on the drawing, with
  `max_spec` / `min_spec` / `mean_value` (matches the Max Spec / Min
  Spec / MEAN rows on the paper sheet)
- `inspections` — a performed inspection: `type` (quote/incoming/setup/
  in_process/final/other — UI creates final/setup/in_process/incoming;
  `quote`/`other` aren't reachable from the UI), part, date, inspector, `status`
  (in_progress/approved/rejected — a `status='approved'` row with a
  non-empty `conditional_reason` displays as "Conditionally Approved";
  see `resultStatus()`/`resultLabel()` in `frontend/src/lib/format.js`),
  plus the full paper header: `customer`, `heat`, `quantity`, `supplier`,
  `po_number`, `customer_po_number`, `operation`, `operation_id` (the
  structured link for In-Process), `job_number`, `sampling_plan_n`,
  `sampling_plan_c`. `lot_disposition` is a legacy free-text column no
  longer surfaced in the UI, superseded by `conditional_reason`.
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
If the repo is checked out on a network/mapped drive, `npm run dev`
(`node --watch`) can crash immediately with `Error: UNKNOWN: unknown
error, watch` — Node's file watcher doesn't support that filesystem.
Fall back to `node src/index.js` (no autoreload; restart manually after
backend changes).

The frontend's Vite dev server is built on the same shaky ground, but
fails differently: it can run for hours and then die mid-session with
`Error: ECONNRESET: connection reset by peer, watch` when the mapped
drive drops the file-watch handle — an uncaught error that kills the
whole process (port 5173 stops responding). There's no steady-state
fallback like the backend's; just restart `npm run dev` again.

## Suggested next task
No build-out task queued right now — the app is in real production use.
Watch for real-world friction reports from operators/QC/engineers rather
than adding new features speculatively; once real inspection data has
accumulated across parts, revisit the Engineer Dashboard (`frontend/src/
pages/Home.jsx`'s `PartAnalyticsSection`) since it was only verified
against seeded demo data.
