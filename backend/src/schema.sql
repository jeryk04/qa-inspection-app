-- Database schema: Inspection App
-- See docs/PLAN.md section 5 for the original data model.

CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  username              TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  full_name             TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'qc' CHECK (role IN ('operator','engineer','qc','supervisor','qa_manager','admin')),
  active                INTEGER NOT NULL DEFAULT 1,
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  last_login            TEXT,
  email                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Additional roles beyond users.role -- a user gets the combined
-- permissions of their main role and every role here (e.g. an Operator who
-- also does QC work). See backend/src/lib/roles.js.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('operator','engineer','qc','supervisor','qa_manager','admin')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  part_number   TEXT NOT NULL,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(client_id, part_number)
);

-- Free-text operation names scoped per part (e.g. "Bending", "Chamfer",
-- "Groove") -- the datasheet-template equivalent of balloon_number: whatever
-- the shop calls this step on this part, not a fixed enum. scope keeps four
-- completely independent operation lists + Data Sheet Templates for the
-- same part -- QC's Set-up, the Operator's own In-Process work, QC's own
-- separate In-Process work (QC has its own "In-Process Inspection" entry
-- point on Home.jsx too, e.g. to cover for an absent operator, but that
-- must never share the Operator's list), and Samples (evaluating a brand
-- new customer or part before it's a qualified production relationship --
-- same operation-scoped shape as Set-up, but must never share its list
-- either, since a part usually keeps its real Set-up/In-Process history
-- going even if it was originally qualified via Samples). All four may
-- track the same real physical step (e.g. all four could have a
-- "Bending"), but as separate operation rows that share nothing -- not
-- specs, not drawings, not history (only the customer/part number has to
-- match across them). Note this is independent of inspections.type, which
-- stays a plain 'setup'/'in_process' paper-form category regardless of
-- which of the two in_process_* scopes created it ('samples' is the one
-- exception -- it has a real, matching inspections.type of its own, since
-- it isn't a paper-form category split like in_process_operator/qc are).
-- UNIQUE is per (part_id, scope, name), not just (part_id, name), so every
-- side can freely reuse the same name (e.g. "Bending") without colliding
-- with any of the other three.
CREATE TABLE IF NOT EXISTS operations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id     INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'setup' CHECK (scope IN ('setup', 'in_process_operator', 'in_process_qc', 'samples')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(part_id, scope, name)
);

-- image_path is nullable: a drawing revision can exist purely to hold Find#
-- columns/specs before any drawing image has been uploaded. version is an
-- internal auto-incrementing counter (drives "latest" ordering only) --
-- revision_label is the free-text revision actually printed on the drawing's
-- title block (e.g. "A", "B", "3"), which doesn't follow any pattern the app
-- can infer, so it's edited manually. operation_id NULL means this is the
-- part's Final Inspection drawing (unchanged current behavior); non-null
-- means it's a datasheet template for that specific operation instead --
-- version is scoped separately within each of those two groups (see the
-- partial unique indexes below).
CREATE TABLE IF NOT EXISTS balloon_drawings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id       INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  image_path    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  revision_label TEXT,
  operation_id  INTEGER REFERENCES operations(id),
  hundred_percent_inspection INTEGER NOT NULL DEFAULT 0, -- 0/1; set once at template setup, copied onto every new inspection created against this drawing (see POST /api/inspections)
  -- 0/1; In-Process only, same inheritance as hundred_percent_inspection above.
  -- Adds Qty/Machine #/Comment fields to each sample row instead of one
  -- shared sampling plan for the whole sheet -- for a periodic check that
  -- rotates through several machines producing the same part, where each
  -- row is its own check event (its own qty and note), not one piece. See
  -- inspection_sample_rows below.
  machine_log_mode INTEGER NOT NULL DEFAULT 0,
  -- In-Process only: re-inspection reminder interval in minutes (NULL =
  -- off). Read live from the template, never copied onto the sheet --
  -- while a Data Sheet on this template is in_progress, its inspector is
  -- reminded once this long has passed since the last reading was saved
  -- (see GET /api/inspections/reminders). Signed sheets never remind.
  reinspect_interval_minutes INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Each "balloon" point (Find #) within a drawing, with its specification.
-- balloon_number is free text, not a strict number — most are "1", "2", etc.
-- but some are named dimensions like "Length" or "Angle". sort_order is the
-- column display order (set to the next available slot when a point is
-- created) — Find# columns are always displayed/sorted by this, never by
-- parsing or alphabetizing balloon_number. decimal_places controls how many
-- decimals this column's spec/measurement values display with (e.g. 0 for a
-- whole-number dimension) — display-only, doesn't affect the stored value.
CREATE TABLE IF NOT EXISTS balloon_points (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id        INTEGER NOT NULL REFERENCES balloon_drawings(id) ON DELETE CASCADE,
  balloon_number    TEXT NOT NULL,
  max_spec          REAL,
  min_spec          REAL,
  mean_value        REAL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  decimal_places    INTEGER NOT NULL DEFAULT 3,
  -- 0/1; whether this column captures as a pass/fail OK/Not-OK check instead
  -- of a numeric measurement (see isSpecless in frontend/src/lib/passfail.js
  -- and its backend twin in src/pdf/inspectionSheet.js). Independent from
  -- whether max_spec/min_spec/mean_value are set -- a check column can still
  -- carry a documented reference spec (e.g. a Go/No-Go gauge's nominal size)
  -- without switching to numeric capture.
  is_check_column   INTEGER NOT NULL DEFAULT 0,
  -- 0/1; a reference dimension -- the drawing prints its spec in
  -- parentheses, e.g. "(5.18)". Display-only: the spec values stay plain
  -- numbers (a MEAN with no Max/Min is never flagged out of tolerance
  -- anyway), and every place that shows the spec wraps it in parentheses.
  -- Set by typing the parentheses in the Data Sheet Template.
  is_reference      INTEGER NOT NULL DEFAULT 0,
  -- Set when a Find# that already has recorded readings is deleted from the
  -- template: it can't be hard-deleted without breaking past Data Sheets, so
  -- it's hidden from the template and from new inspections instead, while
  -- past inspections keep showing it (see getInspectionDetail's points
  -- query). NULL = active. Points with no readings are still hard-deleted.
  retired_at        TEXT,
  UNIQUE(drawing_id, balloon_number)
);

-- type covers the 6 checkboxes on the paper Data Sheet, plus 'samples' --
-- a QC-only type with no paper-form checkbox of its own, for evaluating a
-- brand new customer or part (see operations.scope's comment above; scoped
-- the same way as 'setup', Customer -> Part -> Operations -> Data Sheet).
-- 'quote'/'other' still aren't reachable from the UI; they exist so the
-- model/PDF can already represent them without a schema change later.
CREATE TABLE IF NOT EXISTS inspections (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id             INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  drawing_id          INTEGER REFERENCES balloon_drawings(id),
  type                TEXT NOT NULL CHECK (type IN ('quote', 'incoming', 'setup', 'in_process', 'final', 'other', 'samples')),
  inspector           TEXT,
  date                TEXT NOT NULL DEFAULT (datetime('now')),
  status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'approved', 'rejected')),
  notes               TEXT,
  customer            TEXT,
  heat                TEXT,
  quantity            INTEGER,
  supplier            TEXT,
  po_number           TEXT,
  customer_po_number  TEXT,
  operation           TEXT, -- free-text note/override; unrelated to operation_id below, kept as-is
  operation_id        INTEGER REFERENCES operations(id), -- structured operation link, for in-process inspections
  job_number          TEXT,
  sampling_plan_n     INTEGER,
  sampling_plan_c     INTEGER,
  lot_disposition     TEXT, -- legacy free-text field, superseded by conditional_reason below; kept for old records
  conditional_reason  TEXT, -- required reason text when signed as Conditionally Approved (status stays 'approved')
  requires_in_process INTEGER NOT NULL DEFAULT 0, -- 0/1; Final Inspection only -- see hasQualifyingInProcess in routes/inspections.js
  hundred_percent_inspection INTEGER NOT NULL DEFAULT 0, -- 0/1; In-Process only -- switches specless columns to inspection_point_summaries instead of one measurements row per sample
  machine_log_mode   INTEGER NOT NULL DEFAULT 0, -- 0/1; In-Process only -- see balloon_drawings.machine_log_mode and inspection_sample_rows
  created_by          INTEGER REFERENCES users(id),
  updated_by          INTEGER REFERENCES users(id)
);

-- One cell in the sample x Find# grid: sample_number identifies the
-- inspected piece (1, 2, 3...), balloon_point_id identifies the Find#.
CREATE TABLE IF NOT EXISTS measurements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id     INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  balloon_point_id  INTEGER NOT NULL REFERENCES balloon_points(id),
  sample_number     REAL NOT NULL DEFAULT 1,
  measured_value    REAL,
  within_tolerance  INTEGER, -- 0/1, computed on save
  UNIQUE(inspection_id, balloon_point_id, sample_number)
);

-- A 100%-inspection tally for one Find# column (hundred_percent_inspection=1
-- on the inspection) -- one row per point instead of one measurements row per
-- sample, for a check where every piece in a large lot was inspected and
-- individual per-piece readings aren't the point (e.g. a Fixture/Visual
-- check on 112 pieces). Only ever used for specless (OK/Not-OK) columns; a
-- numeric spec column always keeps its real per-sample measurements rows.
CREATE TABLE IF NOT EXISTS inspection_point_summaries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id     INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  balloon_point_id  INTEGER NOT NULL REFERENCES balloon_points(id),
  qty_inspected     INTEGER NOT NULL DEFAULT 0,
  qty_rejected      INTEGER NOT NULL DEFAULT 0,
  reject_notes      TEXT,
  UNIQUE(inspection_id, balloon_point_id)
);

-- Per-row metadata for machine_log_mode (see inspections.machine_log_mode
-- above) -- a sample row otherwise has no row of its own at all (it's just
-- whatever sample_number values show up in measurements), but this mode's
-- paper form gives each row its own inspected qty, source machine #, and a
-- free-text comment, on top of the usual per-point measurements for that
-- same sample_number. Only ever populated when machine_log_mode is on;
-- harmless (just empty) otherwise.
CREATE TABLE IF NOT EXISTS inspection_sample_rows (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id     INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  sample_number     REAL NOT NULL,
  qty               INTEGER,
  machine_number    TEXT,
  comment           TEXT,
  UNIQUE(inspection_id, sample_number)
);

-- Optional supporting photos on an inspection -- e.g. a non-conformance or
-- visual reference on a Final Inspection. Zero or more per inspection, not
-- tied to a specific balloon_point_id (unlike measurements) since a photo
-- documents the part/lot as a whole, not one Find# reading.
CREATE TABLE IF NOT EXISTS inspection_photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  image_path    TEXT NOT NULL,
  caption       TEXT,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inspection_photos_inspection ON inspection_photos(inspection_id);

-- Supplier certs (material certs, CoCs, plating/heat-treat certs...) attached
-- as PDFs to an Incoming Inspection Data Sheet -- Material, Subcomponent and
-- Subcontractor alike. Kept separate from inspection_photos since a cert is
-- a document of record, not a visual reference, and needs its original file
-- name shown. Zero or more per inspection.
CREATE TABLE IF NOT EXISTS inspection_certs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  original_name TEXT NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inspection_certs_inspection ON inspection_certs(inspection_id);

-- Which of the part's Operator In-Process operations (operations.scope =
-- 'in_process_operator') a Final Inspection requires a sheet for -- picked
-- per operation on the Final's header when the part has more than one. No
-- rows while requires_in_process = 1 means "every Operator operation on the
-- part" (single-operation parts, and Finals from before this existed). See
-- requiredOperationIds in routes/inspections.js.
CREATE TABLE IF NOT EXISTS inspection_required_operations (
  inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  operation_id  INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  PRIMARY KEY (inspection_id, operation_id)
);

-- One row per meaningful action on a record (created / header_updated /
-- measurements_saved / status_changed) for ISO-style traceability of who
-- did what, when. Not a generic per-field diff log.
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  action        TEXT NOT NULL,
  user_id       INTEGER REFERENCES users(id),
  details       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An explicit electronic-signature act (distinct from just clicking a
-- status button): who signed, what they signed for, and when.
CREATE TABLE IF NOT EXISTS signatures (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id   INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  action          TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  signed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin recycle bin. A row captures everything needed to fully restore
-- something an admin-triggered cascade delete removed (see
-- backend/src/lib/trash.js) -- entity_type is only 'operation' today
-- (deleting an Operation now cascades its Data Sheet Template and
-- inspection history instead of being blocked), but the shape is generic
-- so another entity type can reuse it later without a redesign.
-- restored_at stays NULL while the item is still recoverable; once
-- restored (or purged) it's kept for its own record of who did what.
CREATE TABLE IF NOT EXISTS deleted_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  label         TEXT NOT NULL,
  snapshot      TEXT NOT NULL,
  deleted_by    INTEGER REFERENCES users(id),
  deleted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  restored_by   INTEGER REFERENCES users(id),
  restored_at   TEXT
);

-- Which customers a user is assigned to (Admin > Users' "Assigned
-- customers"). For an Operator account, this is a real access restriction --
-- see backend/src/lib/operatorAccess.js -- an Operator can only browse,
-- create, view, or edit In-Process work for a customer listed here. Every
-- other role is unrestricted by customer regardless of what's set here; for
-- them this row is informational only (shown on the user's profile).
CREATE TABLE IF NOT EXISTS user_clients (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);

-- An engineer manually acknowledging one Needs Attention alert (Engineer
-- Dashboard, see GET /inspections/analytics's needsAttention). Keyed by the
-- specific measurement row, not the balloon_point_id -- so a dismissal
-- naturally expires the moment a NEWER measurement is recorded on that
-- same point (pass or fail): the dashboard is by then looking at a
-- different measurement_id, so the old dismissal simply stops applying
-- rather than needing to be cleared by hand. Combined with needsAttention
-- itself only ever considering each point's latest reading, this is the
-- other half of "don't just keep growing": a point that gets re-measured
-- and passes drops off on its own; one that's still failing but has
-- already been reviewed can be dismissed until something actually changes.
CREATE TABLE IF NOT EXISTS dismissed_alerts (
  measurement_id  INTEGER PRIMARY KEY REFERENCES measurements(id) ON DELETE CASCADE,
  dismissed_by    INTEGER REFERENCES users(id),
  dismissed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_parts_client ON parts(client_id);
CREATE INDEX IF NOT EXISTS idx_operations_part ON operations(part_id);
CREATE INDEX IF NOT EXISTS idx_inspections_part ON inspections(part_id);
CREATE INDEX IF NOT EXISTS idx_measurements_inspection ON measurements(inspection_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_signatures_inspection ON signatures(inspection_id);
CREATE INDEX IF NOT EXISTS idx_deleted_items_active ON deleted_items(entity_type, restored_at);

-- A status can only flip to approved/rejected once a matching signature row
-- already exists -- i.e. the signature must be inserted first, in the same
-- transaction, before this update.
CREATE TRIGGER IF NOT EXISTS trg_status_requires_signature
BEFORE UPDATE OF status ON inspections
WHEN NEW.status IN ('approved', 'rejected')
  AND NOT EXISTS (
    SELECT 1 FROM signatures WHERE inspection_id = NEW.id AND action = NEW.status
  )
BEGIN
  SELECT RAISE(ABORT, 'inspections.status cannot be set to approved/rejected without a matching signature');
END;

-- A signature may be recorded while the inspection is still in_progress (the
-- moment just before the status update above) or already carries that exact
-- status. This blocks a signature that contradicts an inspection already
-- resolved to the opposite status. NOTE: "current status must already equal
-- NEW.action" (no in_progress allowance) would deadlock against the trigger
-- above -- neither insert order could ever satisfy both triggers, since each
-- one's precondition is only established by the other statement running
-- first. Allowing in_progress breaks that cycle.
CREATE TRIGGER IF NOT EXISTS trg_signature_requires_status
BEFORE INSERT ON signatures
WHEN (SELECT status FROM inspections WHERE id = NEW.inspection_id) NOT IN ('in_progress', NEW.action)
BEGIN
  SELECT RAISE(ABORT, 'signatures.action does not match the inspection''s current status');
END;
