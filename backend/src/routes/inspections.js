const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/inspections?part_id=1&type=final&client_id=1&status=approved&date_from=2026-01-01&date_to=2026-12-31
router.get("/", (req, res) => {
  const { part_id, type, client_id, status, date_from, date_to } = req.query;

  let query = `
    SELECT i.*, p.part_number, p.client_id, c.name AS client_name
    FROM inspections i
    JOIN parts p ON p.id = i.part_id
    JOIN clients c ON c.id = p.client_id
    WHERE 1 = 1
  `;
  const params = [];

  if (part_id) {
    query += " AND i.part_id = ?";
    params.push(part_id);
  }
  if (type) {
    query += " AND i.type = ?";
    params.push(type);
  }
  if (client_id) {
    query += " AND p.client_id = ?";
    params.push(client_id);
  }
  if (status) {
    query += " AND i.status = ?";
    params.push(status);
  }
  if (date_from) {
    query += " AND i.date >= ?";
    params.push(date_from);
  }
  if (date_to) {
    query += " AND i.date <= ?";
    params.push(date_to + " 23:59:59");
  }
  query += " ORDER BY i.date DESC";

  res.json(db.prepare(query).all(...params));
});

// GET /api/inspections/:id  (includes measurements + specs for each balloon)
router.get("/:id", (req, res) => {
  const inspection = db
    .prepare(
      `SELECT i.*, p.part_number, p.description AS part_description, p.client_id,
              c.name AS client_name
       FROM inspections i
       JOIN parts p ON p.id = i.part_id
       JOIN clients c ON c.id = p.client_id
       WHERE i.id = ?`
    )
    .get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });

  const measurements = db
    .prepare(
      `SELECT m.*, bp.balloon_number, bp.description, bp.nominal_value,
              bp.tolerance_minus, bp.tolerance_plus, bp.unit
       FROM measurements m
       JOIN balloon_points bp ON bp.id = m.balloon_point_id
       WHERE m.inspection_id = ?
       ORDER BY bp.balloon_number`
    )
    .all(req.params.id);

  res.json({ ...inspection, measurements });
});

// POST /api/inspections  (creates the inspection; body: part_id, drawing_id, type, inspector)
router.post("/", (req, res) => {
  const { part_id, drawing_id, type, inspector, notes } = req.body;
  if (!part_id || !type) return res.status(400).json({ error: "part_id and type are required" });

  const result = db
    .prepare(
      "INSERT INTO inspections (part_id, drawing_id, type, inspector, notes) VALUES (?, ?, ?, ?, ?)"
    )
    .run(part_id, drawing_id || null, type, inspector || null, notes || null);

  const inspection = db.prepare("SELECT * FROM inspections WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(inspection);
});

// PUT /api/inspections/:id/measurements  (saves/updates measurements in batch)
// body: { measurements: [{ balloon_point_id, measured_value }, ...] }
router.put("/:id/measurements", (req, res) => {
  const { measurements } = req.body;
  if (!Array.isArray(measurements)) return res.status(400).json({ error: "measurements must be an array" });

  const upsert = db.prepare(`
    INSERT INTO measurements (inspection_id, balloon_point_id, measured_value, within_tolerance)
    VALUES (@inspection_id, @balloon_point_id, @measured_value, @within_tolerance)
    ON CONFLICT(inspection_id, balloon_point_id)
    DO UPDATE SET measured_value = excluded.measured_value, within_tolerance = excluded.within_tolerance
  `);

  const getPoint = db.prepare("SELECT * FROM balloon_points WHERE id = ?");

  const tx = db.transaction((items) => {
    for (const item of items) {
      const point = getPoint.get(item.balloon_point_id);
      let withinTolerance = null;

      if (point && point.nominal_value != null && item.measured_value != null) {
        const min = point.nominal_value - (point.tolerance_minus ?? 0);
        const max = point.nominal_value + (point.tolerance_plus ?? 0);
        withinTolerance = item.measured_value >= min && item.measured_value <= max ? 1 : 0;
      }

      upsert.run({
        inspection_id: req.params.id,
        balloon_point_id: item.balloon_point_id,
        measured_value: item.measured_value,
        within_tolerance: withinTolerance,
      });
    }
  });

  tx(measurements);

  const updated = db
    .prepare(
      `SELECT m.*, bp.balloon_number FROM measurements m
       JOIN balloon_points bp ON bp.id = m.balloon_point_id
       WHERE m.inspection_id = ? ORDER BY bp.balloon_number`
    )
    .all(req.params.id);

  res.json(updated);
});

// PUT /api/inspections/:id/status  (approve/reject)
router.put("/:id/status", (req, res) => {
  const { status } = req.body;
  if (!["in_progress", "approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "invalid status" });
  }
  db.prepare("UPDATE inspections SET status = ? WHERE id = ?").run(status, req.params.id);
  const inspection = db.prepare("SELECT * FROM inspections WHERE id = ?").get(req.params.id);
  res.json(inspection);
});

module.exports = router;
