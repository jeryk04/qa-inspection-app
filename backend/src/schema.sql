-- Database schema: QA Inspection App
-- See docs/PLAN.md section 5 for the original data model.

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  contact       TEXT,
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

CREATE TABLE IF NOT EXISTS balloon_drawings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id       INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  image_path    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Each numbered "balloon" point (Find #) within a drawing, with its specification.
CREATE TABLE IF NOT EXISTS balloon_points (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id        INTEGER NOT NULL REFERENCES balloon_drawings(id) ON DELETE CASCADE,
  balloon_number    INTEGER NOT NULL,
  description       TEXT,
  max_spec          REAL,
  min_spec          REAL,
  mean_value        REAL,
  unit              TEXT DEFAULT 'mm',
  UNIQUE(drawing_id, balloon_number)
);

-- type covers the 6 checkboxes on the paper Data Sheet. Phase 1 UI only
-- creates 'final' inspections; the rest exist so the model/PDF can already
-- represent them without a schema change later.
CREATE TABLE IF NOT EXISTS inspections (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id             INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  drawing_id          INTEGER REFERENCES balloon_drawings(id),
  type                TEXT NOT NULL CHECK (type IN ('quote', 'incoming', 'setup', 'in_process', 'final', 'other')),
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
  operation           TEXT,
  job_number          TEXT,
  sampling_plan_n     INTEGER,
  sampling_plan_c     INTEGER,
  lot_disposition     TEXT,
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

CREATE INDEX IF NOT EXISTS idx_parts_client ON parts(client_id);
CREATE INDEX IF NOT EXISTS idx_inspections_part ON inspections(part_id);
CREATE INDEX IF NOT EXISTS idx_measurements_inspection ON measurements(inspection_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_signatures_inspection ON signatures(inspection_id);
