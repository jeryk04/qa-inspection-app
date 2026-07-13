const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/inspecciones?pieza_id=1&tipo=final
router.get("/", (req, res) => {
  const { pieza_id, tipo, cliente_id } = req.query;

  let query = `
    SELECT i.*, p.numero_parte, p.cliente_id, c.nombre AS cliente_nombre
    FROM inspecciones i
    JOIN piezas p ON p.id = i.pieza_id
    JOIN clientes c ON c.id = p.cliente_id
    WHERE 1 = 1
  `;
  const params = [];

  if (pieza_id) {
    query += " AND i.pieza_id = ?";
    params.push(pieza_id);
  }
  if (tipo) {
    query += " AND i.tipo = ?";
    params.push(tipo);
  }
  if (cliente_id) {
    query += " AND p.cliente_id = ?";
    params.push(cliente_id);
  }
  query += " ORDER BY i.fecha DESC";

  res.json(db.prepare(query).all(...params));
});

// GET /api/inspecciones/:id  (incluye mediciones + specs de cada balloon)
router.get("/:id", (req, res) => {
  const inspeccion = db.prepare("SELECT * FROM inspecciones WHERE id = ?").get(req.params.id);
  if (!inspeccion) return res.status(404).json({ error: "Inspección no encontrada" });

  const mediciones = db
    .prepare(
      `SELECT m.*, bp.numero_balloon, bp.descripcion, bp.valor_nominal,
              bp.tolerancia_menos, bp.tolerancia_mas, bp.unidad
       FROM mediciones m
       JOIN balloon_puntos bp ON bp.id = m.balloon_punto_id
       WHERE m.inspeccion_id = ?
       ORDER BY bp.numero_balloon`
    )
    .all(req.params.id);

  res.json({ ...inspeccion, mediciones });
});

// POST /api/inspecciones  (crea la inspección; body: pieza_id, drawing_id, tipo, inspector)
router.post("/", (req, res) => {
  const { pieza_id, drawing_id, tipo, inspector, notas } = req.body;
  if (!pieza_id || !tipo) return res.status(400).json({ error: "pieza_id y tipo son requeridos" });

  const result = db
    .prepare(
      "INSERT INTO inspecciones (pieza_id, drawing_id, tipo, inspector, notas) VALUES (?, ?, ?, ?, ?)"
    )
    .run(pieza_id, drawing_id || null, tipo, inspector || null, notas || null);

  const inspeccion = db.prepare("SELECT * FROM inspecciones WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(inspeccion);
});

// PUT /api/inspecciones/:id/mediciones  (guarda/actualiza las mediciones en batch)
// body: { mediciones: [{ balloon_punto_id, valor_medido }, ...] }
router.put("/:id/mediciones", (req, res) => {
  const { mediciones } = req.body;
  if (!Array.isArray(mediciones)) return res.status(400).json({ error: "mediciones debe ser un arreglo" });

  const upsert = db.prepare(`
    INSERT INTO mediciones (inspeccion_id, balloon_punto_id, valor_medido, dentro_tolerancia)
    VALUES (@inspeccion_id, @balloon_punto_id, @valor_medido, @dentro_tolerancia)
    ON CONFLICT(inspeccion_id, balloon_punto_id)
    DO UPDATE SET valor_medido = excluded.valor_medido, dentro_tolerancia = excluded.dentro_tolerancia
  `);

  const getPunto = db.prepare("SELECT * FROM balloon_puntos WHERE id = ?");

  const tx = db.transaction((items) => {
    for (const item of items) {
      const punto = getPunto.get(item.balloon_punto_id);
      let dentroTolerancia = null;

      if (punto && punto.valor_nominal != null && item.valor_medido != null) {
        const min = punto.valor_nominal - (punto.tolerancia_menos ?? 0);
        const max = punto.valor_nominal + (punto.tolerancia_mas ?? 0);
        dentroTolerancia = item.valor_medido >= min && item.valor_medido <= max ? 1 : 0;
      }

      upsert.run({
        inspeccion_id: req.params.id,
        balloon_punto_id: item.balloon_punto_id,
        valor_medido: item.valor_medido,
        dentro_tolerancia: dentroTolerancia,
      });
    }
  });

  tx(mediciones);

  const actualizado = db
    .prepare(
      `SELECT m.*, bp.numero_balloon FROM mediciones m
       JOIN balloon_puntos bp ON bp.id = m.balloon_punto_id
       WHERE m.inspeccion_id = ? ORDER BY bp.numero_balloon`
    )
    .all(req.params.id);

  res.json(actualizado);
});

// PUT /api/inspecciones/:id/estado  (aprobar/rechazar)
router.put("/:id/estado", (req, res) => {
  const { estado } = req.body;
  if (!["en_progreso", "aprobada", "rechazada"].includes(estado)) {
    return res.status(400).json({ error: "estado inválido" });
  }
  db.prepare("UPDATE inspecciones SET estado = ? WHERE id = ?").run(estado, req.params.id);
  const inspeccion = db.prepare("SELECT * FROM inspecciones WHERE id = ?").get(req.params.id);
  res.json(inspeccion);
});

module.exports = router;
