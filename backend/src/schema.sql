-- Esquema de base de datos: QA Inspection App
-- Ver docs/PLAN.md sección 5 para el modelo de datos original.

CREATE TABLE IF NOT EXISTS clientes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  contacto      TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS piezas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id    INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  numero_parte  TEXT NOT NULL,
  descripcion   TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(cliente_id, numero_parte)
);

CREATE TABLE IF NOT EXISTS balloon_drawings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pieza_id      INTEGER NOT NULL REFERENCES piezas(id) ON DELETE CASCADE,
  imagen_path   TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cada punto numerado ("balloon") dentro de un drawing, con su especificación.
CREATE TABLE IF NOT EXISTS balloon_puntos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id        INTEGER NOT NULL REFERENCES balloon_drawings(id) ON DELETE CASCADE,
  numero_balloon    INTEGER NOT NULL,
  descripcion       TEXT,
  valor_nominal     REAL,
  tolerancia_menos  REAL,
  tolerancia_mas    REAL,
  unidad            TEXT DEFAULT 'mm',
  UNIQUE(drawing_id, numero_balloon)
);

CREATE TABLE IF NOT EXISTS inspecciones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pieza_id      INTEGER NOT NULL REFERENCES piezas(id) ON DELETE CASCADE,
  drawing_id    INTEGER REFERENCES balloon_drawings(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('incoming', 'setup', 'in_process', 'final')),
  inspector     TEXT,
  fecha         TEXT NOT NULL DEFAULT (datetime('now')),
  estado        TEXT NOT NULL DEFAULT 'en_progreso' CHECK (estado IN ('en_progreso', 'aprobada', 'rechazada')),
  notas         TEXT
);

CREATE TABLE IF NOT EXISTS mediciones (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  inspeccion_id    INTEGER NOT NULL REFERENCES inspecciones(id) ON DELETE CASCADE,
  balloon_punto_id INTEGER NOT NULL REFERENCES balloon_puntos(id),
  valor_medido     REAL,
  dentro_tolerancia INTEGER, -- 0/1, calculado al guardar
  UNIQUE(inspeccion_id, balloon_punto_id)
);

CREATE INDEX IF NOT EXISTS idx_piezas_cliente ON piezas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_inspecciones_pieza ON inspecciones(pieza_id);
CREATE INDEX IF NOT EXISTS idx_mediciones_inspeccion ON mediciones(inspeccion_id);
