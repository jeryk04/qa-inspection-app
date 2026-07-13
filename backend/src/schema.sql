-- Database schema: QA Inspection App
-- See docs/PLAN.md section 5 for the original data model.

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

-- Each numbered "balloon" point within a drawing, with its specification.
CREATE TABLE IF NOT EXISTS balloon_points (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id        INTEGER NOT NULL REFERENCES balloon_drawings(id) ON DELETE CASCADE,
  balloon_number    INTEGER NOT NULL,
  description       TEXT,
  nominal_value     REAL,
  tolerance_minus   REAL,
  tolerance_plus    REAL,
  unit              TEXT DEFAULT 'mm',
  UNIQUE(drawing_id, balloon_number)
);

CREATE TABLE IF NOT EXISTS inspections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id       INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  drawing_id    INTEGER REFERENCES balloon_drawings(id),
  type          TEXT NOT NULL CHECK (type IN ('incoming', 'setup', 'in_process', 'final')),
  inspector     TEXT,
  date          TEXT NOT NULL DEFAULT (datetime('now')),
  status        TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'approved', 'rejected')),
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id     INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  balloon_point_id  INTEGER NOT NULL REFERENCES balloon_points(id),
  measured_value    REAL,
  within_tolerance  INTEGER, -- 0/1, computed on save
  UNIQUE(inspection_id, balloon_point_id)
);

CREATE INDEX IF NOT EXISTS idx_parts_client ON parts(client_id);
CREATE INDEX IF NOT EXISTS idx_inspections_part ON inspections(part_id);
CREATE INDEX IF NOT EXISTS idx_measurements_inspection ON measurements(inspection_id);
