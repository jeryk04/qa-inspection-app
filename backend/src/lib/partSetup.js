const db = require("../db");

// Setup status per part for Browse Customers: for each inspection type,
// whether its Data Sheet Template is set up and whether a drawing file is
// attached. "Set up" means the template's current revision (the latest
// drawing version in that bucket -- what a new Data Sheet is created
// against) has at least one active Find# column; "drawing attached" means
// that revision has an uploaded image/PDF (image_path), since a revision can
// exist purely to hold Find# columns (see schema.sql's balloon_drawings).
//
// Final and Incoming share the part's default template (operation_id IS
// NULL); Set-up, both In-Process lists and Samples have one template per
// operation, so those report every operation in their list.
const OPERATION_SCOPES = ["setup", "in_process_qc", "in_process_operator", "samples"];

function emptyStatus() {
  return {
    final: { template: false, points: 0, drawing: false, revision: null, image_path: null },
    ...Object.fromEntries(OPERATION_SCOPES.map((s) => [s, []])),
  };
}

// partIds -> Map(part_id -> status)
function partSetupStatus(partIds) {
  const byPart = new Map(partIds.map((id) => [id, emptyStatus()]));
  if (partIds.length === 0) return byPart;
  const ids = JSON.stringify(partIds);

  // The current revision of every template bucket (part default + each
  // operation) for these parts, with its active Find# count.
  const latest = db
    .prepare(
      `SELECT l.part_id, l.operation_id, l.image_path, l.revision_label,
              (SELECT COUNT(*) FROM balloon_points bp WHERE bp.drawing_id = l.id AND bp.retired_at IS NULL) AS points
       FROM (
         SELECT d.*, ROW_NUMBER() OVER (
           PARTITION BY d.part_id, COALESCE(d.operation_id, 0) ORDER BY d.version DESC, d.id DESC
         ) AS rn
         FROM balloon_drawings d
         WHERE d.part_id IN (SELECT value FROM json_each(?))
       ) l
       WHERE l.rn = 1`
    )
    .all(ids);
  const latestByOperation = new Map();
  for (const d of latest) {
    const summary = {
      template: d.points > 0,
      points: d.points,
      drawing: d.image_path != null,
      revision: d.revision_label?.trim() || null,
      image_path: d.image_path,
    };
    if (d.operation_id == null) byPart.get(d.part_id).final = summary;
    else latestByOperation.set(d.operation_id, summary);
  }

  const operations = db
    .prepare(
      `SELECT id, part_id, name, scope FROM operations
       WHERE part_id IN (SELECT value FROM json_each(?))
       ORDER BY name COLLATE NOCASE`
    )
    .all(ids);
  for (const o of operations) {
    const status = byPart.get(o.part_id);
    if (!status || !status[o.scope]) continue;
    status[o.scope].push({
      id: o.id,
      name: o.name,
      ...(latestByOperation.get(o.id) || { template: false, points: 0, drawing: false, revision: null, image_path: null }),
    });
  }
  return byPart;
}

module.exports = { partSetupStatus, OPERATION_SCOPES };
