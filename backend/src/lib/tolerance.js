// Supports one-sided specs (max-only = "must not exceed", min-only = "must be at
// least") as well as two-sided tolerance bands. Returns null when neither bound
// is set, since there's nothing to check the measurement against.
function computeWithinTolerance(point, measuredValue) {
  if (!point || measuredValue == null) return null;
  // Points with no spec accept free text (e.g. "OK" on a Fixture check) --
  // never numerically comparable, so nothing to flag.
  if (typeof measuredValue !== "number" || Number.isNaN(measuredValue)) return null;
  const hasMax = point.max_spec != null;
  const hasMin = point.min_spec != null;
  if (!hasMax && !hasMin) return null;
  if (hasMax && measuredValue > point.max_spec) return 0;
  if (hasMin && measuredValue < point.min_spec) return 0;
  return 1;
}

// within_tolerance is stored per reading at save time, but every report reads
// the spec live from balloon_points -- so after a point's spec is edited, its
// existing readings must be re-checked or the sheet shows the new spec next to
// a stale pass/fail flag. Returns the readings whose flag actually changed.
function recomputePointTolerance(db, point) {
  const readings = db
    .prepare("SELECT id, inspection_id, sample_number, measured_value, within_tolerance FROM measurements WHERE balloon_point_id = ?")
    .all(point.id);
  const update = db.prepare("UPDATE measurements SET within_tolerance = ? WHERE id = ?");
  const changed = [];
  for (const r of readings) {
    const next = computeWithinTolerance(point, r.measured_value);
    if (next !== r.within_tolerance) {
      update.run(next, r.id);
      changed.push({ ...r, new_within_tolerance: next });
    }
  }
  return changed;
}

module.exports = { computeWithinTolerance, recomputePointTolerance };
