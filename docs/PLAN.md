# QA Inspection App — Digital Inspections

*Project Plan · v1.0*

## 1. Project Summary

Quality control is currently handled through Excel inspection sheets,
stored in folders organized by client and part number. This process
limits traceability, makes trend analysis difficult, and relies on
manual, scattered data handling.

The goal is to build a digital application that captures, stores, and
organizes quality inspections — replacing the paper/Excel process — so
that all data is centralized, searchable by client and part number, and
can be used in the future for analysis and trend control.

## 2. Inspection Types Covered

| Inspection Type | Description |
|---|---|
| Incoming Inspection | Verification of material or parts received from suppliers. |
| Set-up Inspection | Validation before starting a production run. |
| In-Process Inspection | Verification during the production process. |
| Final Inspection | Final validation before shipping to the client. |

## 3. Goals and Success Criteria

- Eliminate the use of paper/Excel inspection sheets.
- Centralize all inspection information by client and part number.
- Capture measurements based on Balloon Drawings (drawings with numbered points and their spec/tolerance).
- Automatically generate the digital inspection sheet (a direct replacement for the physical sheet).
- Leave the foundation ready for trend analysis and reporting in later phases.

## 4. General Approach

The project will be built in incremental phases, starting with an MVP
(Minimum Viable Product) focused on a single inspection type, to
validate the full flow before expanding to the others.

### Phase 1 — MVP: Digital Final Inspection

**In scope:**
- Measurement capture by balloon number (numbered form).
- Associating each inspection with a client + part number.
- Generating and storing the digital inspection sheet.
- Access from the shop floor (tablet/mobile) and the office (desktop).
- Inspection history searchable by client/part.

**Out of scope (later phases):**
- Incoming, Set-up, and In-Process Inspections.
- Trend analysis, reports, and dashboards.
- Automatic out-of-tolerance alerts.
- MIE Trak Pro integration.
- External client access to the system.

### Phase 2 — Inspection Expansion

Add Incoming, Set-up, and In-Process Inspections, reusing the foundation
built in Phase 1 (same data model and capture flow).

### Phase 3 — Analysis, Reporting, and Integration

- Trend analysis and historical quality control module.
- Out-of-tolerance alerts.
- Evaluate MIE Trak Pro integration to sync client/part data.
- AI platform (chat assistant, anomaly detection, computer vision) —
  see `docs/AI_PLATFORM_PLAN.md` for the detailed plan. Not started.

## 5. Data Model

Reflects the company's actual paper Data Sheet: each inspection is a
grid of samples (pieces inspected) × balloon points (Find #), not a
single value per point.

| Entity | Key Fields |
|---|---|
| Clients | id, name |
| Parts | id, client_id, part number, description |
| Balloon Drawings | id, part_id, image, list of numbered Find # points |
| Balloon Points | id, drawing_id, balloon_number (Find #), description, max_spec, min_spec, mean_value, unit |
| Inspections | id, part_id, type, date, inspector, status, notes, customer, heat, quantity, supplier, po_number, customer_po_number, operation, job_number, sampling_plan_n, sampling_plan_c, lot_disposition |
| Measurements | id, inspection_id, balloon_point_id, sample_number, measured value, within tolerance (yes/no) |

The digital inspection sheet can be exported as a PDF that visually
replicates the paper Data Sheet (logo, type checkboxes, header fields,
and the Find # × sample grid).

## 6. Suggested Tech Stack

| Component | Recommendation |
|---|---|
| Frontend | React (or plain HTML/JS to start lighter) |
| Backend | Node.js + Express, or Python + FastAPI |
| Database | SQLite for local development → PostgreSQL in production |
| Image storage | Local at first → cloud storage (e.g. S3) later |
| Development environment | Visual Studio Code |

## 7. Task Breakdown — Phase 1 (MVP)

1. Initial setup: project in VS Code, folder structure, local database.
2. CRUD for Clients and Parts.
3. Balloon Drawing upload: upload image and define the list of numbered points with their spec/tolerance.
4. Inspection capture form: select client → part → capture measured values per balloon number.
5. Automatic tolerance validation (visual within/out-of-spec indicator).
6. Generate the digital inspection sheet (view and/or PDF export).
7. Inspection history and search by client, part, and date.
8. Testing with real data in parallel with the current process, before retiring paper/Excel.

## 8. Notes and Considerations

- There's no fixed deadline — development will happen iteratively, testing and fixing as it goes.
- The current Excel data (organized by client and part number) serves as a direct reference for the initial data model.
- MIE Trak Pro integration is identified as a future goal, not an MVP blocker.
