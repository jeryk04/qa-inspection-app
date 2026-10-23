const express = require("express");
const multer = require("multer");
const path = require("path");
const db = require("../db");
const { generateInspectionPdf } = require("../pdf/inspectionSheet");
const {
  recordAudit,
  recordHeaderAudit,
  recordMeasurementsAudit,
  recordPointSummariesAudit,
  recordSampleRowsAudit,
} = require("../lib/audit");
const { signInspectionStatus } = require("../lib/inspectionSigning");
const { parsePassFailState } = require("../lib/passfail");
const attachRole = require("../middleware/attachRole");
const requireRole = require("../middleware/requireRole");
const { isAssignedToClient } = require("../lib/operatorAccess");
const { computeWithinTolerance } = require("../lib/tolerance");

const router = express.Router();

// Supporting photos (POST /:id/photos below) -- same disk-storage pattern as
// drawings.js's upload, kept local here rather than shared since the two
// serve different purposes (a drawing image vs. an optional inspection
// attachment) and the config is a few lines either way.
const photoStorage = multer.diskStorage({
  destination: path.join(__dirname, "..", "..", "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `photo-${Date.now()}${ext}`);
  },
});
const uploadPhoto = multer({
  storage: photoStorage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files can be attached as inspection photos."));
    }
    cb(null, true);
  },
});

// Supplier certs (POST /:id/certs below) -- PDFs only, same disk storage.
const certStorage = multer.diskStorage({
  destination: path.join(__dirname, "..", "..", "uploads"),
  filename: (req, file, cb) => {
    cb(null, `cert-${Date.now()}.pdf`);
  },
});
const uploadCert = multer({
  storage: certStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === "application/pdf" || path.extname(file.originalname).toLowerCase() === ".pdf";
    if (!isPdf) return cb(new Error("Only PDF files can be attached as certs."));
    cb(null, true);
  },
});

// Operators only ever do In-Process (see CLAUDE.md) -- everyone else
// (qc/admin/engineer) is unrestricted by type here. Used on create and on
// every edit to an existing inspection, keyed off that inspection's own
// (immutable) type rather than anything client-supplied.
function canAccessType(role, type) {
  if (role === "operator") return type === "in_process";
  return true;
}

// Operators' In-Process work only ever covers customers an admin has
// assigned them to via user_clients (see lib/operatorAccess.js and Admin >
// Users' "Assigned customers") -- checked on create and on every subsequent
// view/edit of that inspection below, not just create, so un-assigning a
// customer takes effect immediately rather than only blocking new work.
// (This replaced a hardcoded, admin-account-shared customer name list that
// had to be hand-edited and kept in sync with a duplicate copy in
// Clients.jsx -- that's exactly the kind of drift that once silently
// blocked "Environment One Corp" until someone noticed.)

const HEADER_FIELDS = [
  "customer",
  "heat",
  "quantity",
  "supplier",
  "po_number",
  "customer_po_number",
  "operation",
  "job_number",
  "inspector",
  "sampling_plan_n",
  "sampling_plan_c",
  "notes",
  "requires_in_process",
  "hundred_percent_inspection",
  "machine_log_mode",
];

// Booleans stored as 0/1 INTEGER columns -- special-cased on every read of
// req.body for these fields (POST's columns mapping and PUT's normalize
// step below) since better-sqlite3 can't bind a raw JS boolean, and a plain
// `?? null` would violate their NOT NULL constraint when omitted on create.
const BOOLEAN_HEADER_FIELDS = ["requires_in_process", "hundred_percent_inspection", "machine_log_mode"];

// Final Inspection's "Operator In-Process Data Sheet required" gate (see PUT
// /:id/status): satisfied by any in_process inspection on the same part that
// actually has recorded work -- either real measurements rows, or (for a
// hundred_percent_inspection) a point-summary tally with a non-zero qty
// inspected. An empty auto-provisioned row with neither doesn't count as
// "the operator did their check". Scoped to the same WO#/Job# when the Final
// Inspection has one, since that's the specific production run being signed
// off; falls back to "any WO# for this part" when it doesn't.
function hasQualifyingInProcess(partId, jobNumber) {
  const jobFilter = jobNumber && jobNumber.trim() ? "AND ip.job_number = @jobNumber" : "";
  const row = db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM inspections ip
         WHERE ip.part_id = @partId
           AND ip.type = 'in_process'
           ${jobFilter}
           AND (
             EXISTS (SELECT 1 FROM measurements m WHERE m.inspection_id = ip.id)
             OR EXISTS (SELECT 1 FROM inspection_point_summaries ips WHERE ips.inspection_id = ip.id AND ips.qty_inspected > 0)
           )
       ) AS found`
    )
    .get({ partId, jobNumber: jobNumber || null });
  return !!row.found;
}

// GET /api/inspections?part_id=1&type=final&client_id=1&status=approved&date_from=2026-01-01&date_to=2026-12-31&operation_id=1&job_number=12345
// A "blank" Data Sheet: opened (still in_progress, never signed) but nothing
// recorded on it -- no measurements, 100% tallies, sample-log rows, photos
// or certs. Header fields alone don't count. These can be discarded by QC
// and (for their own In-Process sheets) Operators, not just admin/supervisor
// -- see DELETE /:id. `i` must be the inspections alias in scope.
const IS_BLANK_SQL = `(
  i.status = 'in_progress'
  AND NOT EXISTS (SELECT 1 FROM signatures x WHERE x.inspection_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM measurements x WHERE x.inspection_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM inspection_point_summaries x WHERE x.inspection_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM inspection_sample_rows x WHERE x.inspection_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM inspection_photos x WHERE x.inspection_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM inspection_certs x WHERE x.inspection_id = i.id)
)`;

router.get("/", (req, res) => {
  const { part_id, type, client_id, status, date_from, date_to, operation_id, job_number } = req.query;

  // created_by_name: who actually created this Data Sheet record (a real FK
  // to the logged-in account, not the free-text "inspector" header field
  // anyone can type/leave blank) -- LEFT JOIN since created_by is nullable
  // (older rows, or ones created some other way) and shouldn't drop the
  // inspection from the list just because that link is missing.
  let query = `
    SELECT i.*, p.part_number, p.client_id, c.name AS client_name, u.full_name AS created_by_name,
           ${IS_BLANK_SQL} AS is_blank
    FROM inspections i
    JOIN parts p ON p.id = i.part_id
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN users u ON u.id = i.created_by
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
  if (operation_id) {
    query += " AND i.operation_id = ?";
    params.push(operation_id);
  }
  if (client_id) {
    query += " AND p.client_id = ?";
    params.push(client_id);
  }
  // Partial, case-insensitive match -- a WO# lookup across every customer,
  // part, and inspection type (Final/Set-up/In-Process/Incoming all write to
  // the same job_number column), so an inspector doesn't need to remember
  // the exact formatting or which part it was recorded under.
  if (job_number) {
    query += " AND i.job_number LIKE ? COLLATE NOCASE";
    params.push(`%${job_number}%`);
  }
  // 'conditionally_approved' isn't a real i.status value (see PUT
  // /:id/status) -- it's status='approved' with a reason attached, so the
  // filter has to distinguish it from a plain approval by that instead.
  if (status === "conditionally_approved") {
    query += " AND i.status = 'approved' AND i.conditional_reason IS NOT NULL AND i.conditional_reason != ''";
  } else if (status === "approved") {
    query += " AND i.status = 'approved' AND (i.conditional_reason IS NULL OR i.conditional_reason = '')";
  } else if (status) {
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

// GET /api/inspections/status-lookup?part_number=...&job_number=...  (operator floor
// lookup: lightweight status info only, no measurements/full detail)
// Scoped to inspections created_by the logged-in user's id (a real FK match,
// not a free-text comparison against the inspector field) --
// deliberately scoped per-operator for now (an operator only sees their own work),
// can be loosened to company-wide visibility later if needed.
router.get("/status-lookup", attachRole, requireRole("operator", "qc", "admin", "supervisor"), (req, res) => {
  const { part_number, job_number } = req.query;
  if (!part_number) return res.status(400).json({ error: "part_number is required" });

  let query = `
    SELECT i.id, p.part_number, i.job_number, i.type, i.status, i.conditional_reason, i.date, i.inspector
    FROM inspections i
    JOIN parts p ON p.id = i.part_id
    WHERE LOWER(p.part_number) = LOWER(?) AND i.created_by = ?
  `;
  const params = [part_number, req.user.id];

  if (job_number) {
    query += " AND i.job_number = ?";
    params.push(job_number);
  }
  query += " ORDER BY i.date DESC";

  res.json(db.prepare(query).all(...params));
});

// GET /api/inspections/dashboard-stats?mine=1&type=in_process
// Home screen's live stats strip + recent-activity feed. mine=1 scopes
// everything to the logged-in user's own created_by (used by the Operator
// dashboard, mirroring status-lookup's per-operator scoping above) --
// omitted for the QC/Admin dashboard, which is company-wide across every
// inspector and inspection type.
router.get("/dashboard-stats", (req, res) => {
  const { mine, type } = req.query;

  const scope = [];
  const params = [];
  if (mine) {
    scope.push("i.created_by = ?");
    params.push(req.user.id);
  }
  if (type) {
    scope.push("i.type = ?");
    params.push(type);
  }
  const where = scope.length ? `AND ${scope.join(" AND ")}` : "";

  const openCount = db
    .prepare(`SELECT COUNT(*) AS n FROM inspections i WHERE i.status = 'in_progress' ${where}`)
    .get(...params).n;

  const approvedCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM signatures s JOIN inspections i ON i.id = s.inspection_id
       WHERE s.action = 'approved' AND s.signed_at >= datetime('now', '-7 days') ${where}`
    )
    .get(...params).n;

  const rejectedCount = db
    .prepare(
      `SELECT COUNT(*) AS n FROM signatures s JOIN inspections i ON i.id = s.inspection_id
       WHERE s.action = 'rejected' AND s.signed_at >= datetime('now', '-7 days') ${where}`
    )
    .get(...params).n;

  // Signature events (not audit_log generally) -- these are the meaningful
  // "outcome" moments an inspector cares about at a glance, each with an
  // exact signed_at timestamp already. operation_scope tells Operator vs QC
  // apart for In-Process (both share inspections.type = 'in_process');
  // creator_role is the fallback for everything without an operation.
  const recentActivity = db
    .prepare(
      `SELECT s.action, s.signed_at AS at, i.id AS inspection_id, i.type, i.job_number,
              p.part_number, c.name AS client_name,
              o.name AS operation_name, o.scope AS operation_scope,
              u.role AS creator_role
       FROM signatures s
       JOIN inspections i ON i.id = s.inspection_id
       JOIN parts p ON p.id = i.part_id
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN operations o ON o.id = i.operation_id
       LEFT JOIN users u ON u.id = i.created_by
       WHERE 1 = 1 ${where}
       ORDER BY s.signed_at DESC
       LIMIT 6`
    )
    .all(...params);

  res.json({ openCount, approvedCount, rejectedCount, recentActivity });
});

// GET /api/inspections/recent-activity?type=&client_id=&result=&q=&limit=&offset=&mine=1
// Home's Recent Activity feed: one row per signed Data Sheet, as of its
// LATEST signature -- a sheet reopened and re-signed shows once (not once
// per signing), and one reopened but not yet re-signed drops out until it's
// signed again. `result` is the UI-facing result (conditionally_approved is
// status='approved' + conditional_reason, see PUT /:id/status). `mine` means
// sheets the user created OR last signed (operators sign their own In-Process
// sheets now, even ones QC set up for them); operators always get `mine`.
// `customers` lists every customer with signed activity in the same
// mine/type scope (ignoring the other filters), for the Customer dropdown.
router.get("/recent-activity", attachRole, (req, res) => {
  const { type, client_id, result, q } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const mine = req.user.role === "operator" || !!req.query.mine;

  const scope = ["i.status IN ('approved', 'rejected')"];
  const scopeParams = [];
  if (mine) {
    scope.push("(i.created_by = ? OR s.user_id = ?)");
    scopeParams.push(req.user.id, req.user.id);
  }
  if (type) {
    scope.push("i.type = ?");
    scopeParams.push(type);
  }

  // Each signed sheet joined to its latest signature -- shared by the feed
  // and the customer list so both see the same scope.
  const fromLatestSignature = `
       FROM inspections i
       JOIN signatures s ON s.id = (
         SELECT s2.id FROM signatures s2 WHERE s2.inspection_id = i.id
         ORDER BY s2.signed_at DESC, s2.id DESC LIMIT 1
       )
       JOIN parts p ON p.id = i.part_id
       JOIN clients c ON c.id = p.client_id`;

  const filters = [...scope];
  const filterParams = [...scopeParams];
  if (client_id) {
    filters.push("p.client_id = ?");
    filterParams.push(Number(client_id));
  }
  if (result === "approved") {
    filters.push("i.status = 'approved' AND COALESCE(TRIM(i.conditional_reason), '') = ''");
  } else if (result === "conditionally_approved") {
    filters.push("i.status = 'approved' AND COALESCE(TRIM(i.conditional_reason), '') <> ''");
  } else if (result === "rejected") {
    filters.push("i.status = 'rejected'");
  }
  if (q && q.trim()) {
    filters.push("(p.part_number LIKE ? OR i.job_number LIKE ? OR i.po_number LIKE ?)");
    const like = `%${q.trim()}%`;
    filterParams.push(like, like, like);
  }

  const rows = db
    .prepare(
      `SELECT i.id AS inspection_id, i.type, i.status, i.conditional_reason, i.job_number, i.po_number,
              s.signed_at AS at, signer.full_name AS signer_name,
              p.part_number, c.id AS client_id, c.name AS client_name,
              o.name AS operation_name, o.scope AS operation_scope,
              u.role AS creator_role
       ${fromLatestSignature}
       LEFT JOIN users signer ON signer.id = s.user_id
       LEFT JOIN operations o ON o.id = i.operation_id
       LEFT JOIN users u ON u.id = i.created_by
       WHERE ${filters.join(" AND ")}
       ORDER BY s.signed_at DESC, s.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...filterParams, limit + 1, offset);

  const customers = db
    .prepare(
      `SELECT DISTINCT c.id, c.name
       ${fromLatestSignature}
       WHERE ${scope.join(" AND ")}
       ORDER BY c.name COLLATE NOCASE`
    )
    .all(...scopeParams);

  res.json({ items: rows.slice(0, limit), hasMore: rows.length > limit, customers });
});

// GET /api/inspections/analytics -- the Engineer dashboard's charts.
// Company-wide only (no mine=1 scoping like dashboard-stats above) since
// trend/tolerance analysis across parts doesn't make sense scoped to one
// operator's own work.
router.get("/analytics", attachRole, requireRole("qc", "admin", "engineer", "supervisor"), (req, res) => {
  // Zero-filled so the trend line has a real point for every day in the
  // window, not just the days something happened to be dated to.
  const volumeRows = db
    .prepare(
      `SELECT date(date) AS day, COUNT(*) AS c FROM inspections
       WHERE date >= date('now', '-30 days')
       GROUP BY day`
    )
    .all();
  const volumeByDayMap = new Map(volumeRows.map((r) => [r.day, r.c]));
  const volumeByDay = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    volumeByDay.push({ date: day, count: volumeByDayMap.get(day) || 0 });
  }

  // Same "conditionally approved = approved + a real conditional_reason"
  // rule frontend/src/lib/format.js's resultStatus() applies client-side,
  // mirrored here in SQL so the two never drift apart.
  const statusRows = db
    .prepare(
      `SELECT
         CASE
           WHEN status = 'approved' AND conditional_reason IS NOT NULL AND conditional_reason != ''
             THEN 'conditionally_approved'
           ELSE status
         END AS bucket,
         COUNT(*) AS c
       FROM inspections
       GROUP BY bucket`
    )
    .all();
  const statusBreakdown = { in_progress: 0, approved: 0, conditionally_approved: 0, rejected: 0 };
  statusRows.forEach((r) => {
    if (r.bucket in statusBreakdown) statusBreakdown[r.bucket] = r.c;
  });

  // Pass/fail across EVERY filled-in measurement, numeric or specless --
  // not all Data Sheets have real numeric readings; a specless (Fixture/
  // Visual-style) column stores "OK"/"NOT OK ..." text instead, with
  // within_tolerance always null for those (nothing numeric to compare --
  // see computeWithinTolerance in lib/tolerance.js). Treating a "NOT OK" the same as a
  // numeric out-of-tolerance reading is what makes this dashboard reflect
  // the majority of what's actually recorded, not just the numeric slice.
  // One pass over every non-blank row builds all three of tolerance /
  // topOutOfTolerance / needsAttention together, since they're the same
  // classification sliced three ways.
  const allMeasurements = db
    .prepare(
      `SELECT m.id AS measurement_id, m.measured_value, m.within_tolerance, i.date,
              bp.id AS balloon_point_id, bp.balloon_number, bp.max_spec, bp.min_spec,
              p.id AS part_id, p.part_number, p.client_id, c.name AS client_name
       FROM measurements m
       JOIN balloon_points bp ON bp.id = m.balloon_point_id
       JOIN balloon_drawings d ON d.id = bp.drawing_id
       JOIN parts p ON p.id = d.part_id
       JOIN clients c ON c.id = p.client_id
       JOIN inspections i ON i.id = m.inspection_id
       WHERE m.measured_value IS NOT NULL
       ORDER BY i.date DESC`
    )
    .all();
  const dismissedIds = new Set(db.prepare("SELECT measurement_id FROM dismissed_alerts").all().map((r) => r.measurement_id));

  const classify = (row) => {
    if (row.within_tolerance != null) return row.within_tolerance ? "pass" : "fail";
    const state = parsePassFailState(row.measured_value);
    return state === "ok" ? "pass" : state === "not_ok" ? "fail" : null;
  };

  let within = 0;
  let outOf = 0;
  const failsByPoint = new Map(); // balloon_point_id -> { count, balloon_number, part_number, client_name }
  // The all-time tally above intentionally counts every reading ever taken.
  // needsAttention is different: it should only list a point if its LATEST
  // reading (not just its latest FAILING one) is currently a fail -- a
  // point that failed yesterday but has since been re-measured and passed
  // must drop off on its own, not linger forever just because a failure
  // happened at some point in its history. allMeasurements is already
  // date-DESC, so the first row seen per point is that point's latest.
  const latestByPoint = new Map();

  allMeasurements.forEach((row) => {
    const outcome = classify(row);
    if (outcome == null) return; // free text that predates the OK/Not-OK convention

    if (outcome === "pass") within += 1;
    else outOf += 1;

    if (outcome === "fail") {
      const existing = failsByPoint.get(row.balloon_point_id);
      if (existing) existing.count += 1;
      else
        failsByPoint.set(row.balloon_point_id, {
          count: 1,
          balloon_number: row.balloon_number,
          part_number: row.part_number,
          client_name: row.client_name,
        });
    }

    if (!latestByPoint.has(row.balloon_point_id)) latestByPoint.set(row.balloon_point_id, row);
  });

  const needsAttention = [...latestByPoint.values()]
    .filter((row) => classify(row) === "fail" && !dismissedIds.has(row.measurement_id))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 10)
    .map((row) => ({
      measurement_id: row.measurement_id,
      balloon_point_id: row.balloon_point_id,
      balloon_number: row.balloon_number,
      measured_value: row.measured_value,
      max_spec: row.max_spec,
      min_spec: row.min_spec,
      date: row.date,
      part_id: row.part_id,
      part_number: row.part_number,
      client_id: row.client_id,
      client_name: row.client_name,
    }));

  // Pareto ranking -- cumulativePct is relative to the TRUE total of every
  // failing point (not just the top 10 shown), so it correctly approaches
  // 100% as more of the long tail would be included, rather than capping
  // artificially low if there are more than 10 distinct failing points.
  const allFails = [...failsByPoint.values()].sort((a, b) => b.count - a.count);
  const totalFails = allFails.reduce((sum, f) => sum + f.count, 0);
  let runningFails = 0;
  const topOutOfTolerance = allFails.slice(0, 10).map((f) => {
    runningFails += f.count;
    return {
      ...f,
      pct: totalFails > 0 ? Math.round((f.count / totalFails) * 1000) / 10 : 0,
      cumulativePct: totalFails > 0 ? Math.round((runningFails / totalFails) * 1000) / 10 : 0,
    };
  });

  res.json({
    volumeByDay,
    statusBreakdown,
    tolerance: { within, outOf },
    topOutOfTolerance,
    needsAttention,
  });
});

// POST /api/inspections/analytics/dismiss-alert  { measurement_id } -- an
// engineer manually acknowledging one Needs Attention row (see
// dismissed_alerts in schema.sql for why this is keyed by measurement_id,
// not balloon_point_id: a newer measurement on the same point naturally
// supersedes the dismissal instead of needing it cleared by hand).
router.post("/analytics/dismiss-alert", attachRole, requireRole("qc", "admin", "engineer", "supervisor"), (req, res) => {
  const { measurement_id } = req.body;
  if (!measurement_id) return res.status(400).json({ error: "measurement_id is required" });
  if (!db.prepare("SELECT 1 FROM measurements WHERE id = ?").get(measurement_id)) {
    return res.status(404).json({ error: "Measurement not found" });
  }
  db.prepare("INSERT OR IGNORE INTO dismissed_alerts (measurement_id, dismissed_by) VALUES (?, ?)").run(
    measurement_id,
    req.user.id
  );
  res.status(204).send();
});

function getInspectionDetail(id) {
  const inspection = db
    .prepare(
      `SELECT i.*, p.part_number, p.description AS part_description, p.client_id,
              c.name AS client_name, o.name AS operation_name, o.scope AS operation_scope
       FROM inspections i
       JOIN parts p ON p.id = i.part_id
       JOIN clients c ON c.id = p.client_id
       LEFT JOIN operations o ON o.id = i.operation_id
       WHERE i.id = ?`
    )
    .get(id);
  if (!inspection) return null;

  const measurements = db
    .prepare(
      `SELECT m.*, bp.balloon_number, bp.max_spec, bp.min_spec, bp.mean_value, bp.sort_order, bp.decimal_places,
              bp.is_reference, bp.is_check_column
       FROM measurements m
       JOIN balloon_points bp ON bp.id = m.balloon_point_id
       WHERE m.inspection_id = ?
       ORDER BY bp.sort_order, m.sample_number`
    )
    .all(id);

  // hundred_percent_inspection's per-column tallies (see schema.sql) --
  // parallel to `measurements` above, one row per Find# instead of one per
  // sample. Harmless to fetch even when the inspection isn't in that mode;
  // it'll just always be empty.
  const pointSummaries = db
    .prepare(
      `SELECT ips.*, bp.balloon_number, bp.sort_order
       FROM inspection_point_summaries ips
       JOIN balloon_points bp ON bp.id = ips.balloon_point_id
       WHERE ips.inspection_id = ?
       ORDER BY bp.sort_order`
    )
    .all(id);

  // machine_log_mode's per-row qty/machine/comment (see schema.sql) --
  // harmless to fetch even when the inspection isn't in that mode; it'll
  // just always be empty.
  const sampleRows = db
    .prepare("SELECT * FROM inspection_sample_rows WHERE inspection_id = ? ORDER BY sample_number")
    .all(id);

  // All Find# columns defined on the drawing — independent of whether they
  // have a recorded measurement yet, so the sheet/PDF grid shows every
  // column from the start instead of only ones that already have data.
  const points = inspection.drawing_id
    ? db
        .prepare(
          `SELECT id, balloon_number, max_spec, min_spec, mean_value, decimal_places, is_reference, is_check_column
           FROM balloon_points WHERE drawing_id = ? ORDER BY sort_order`
        )
        .all(inspection.drawing_id)
    : [];

  // The electronic signature that approved/rejected this Data Sheet, if it's
  // been signed — used by both the on-screen report and the PDF export.
  const signature = db
    .prepare(
      `SELECT s.action, s.signed_at, u.full_name
       FROM signatures s JOIN users u ON u.id = s.user_id
       WHERE s.inspection_id = ? ORDER BY s.signed_at DESC LIMIT 1`
    )
    .get(id);

  // When this Final Inspection requires an Operator In-Process Data Sheet
  // (see requires_in_process / hasQualifyingInProcess), the printed record
  // bundles that companion sheet in too, not just a "yes it exists" check --
  // same part, same WO#/Job# when this one has it (else any WO# for the
  // part, matching hasQualifyingInProcess's own fallback), preferring a
  // signed one and the most recent if more than one matches.
  let linkedInProcess = null;
  if (inspection.type === "final" && inspection.requires_in_process) {
    const jobFilter = inspection.job_number && inspection.job_number.trim() ? "AND ip.job_number = @jobNumber" : "";
    const linked = db
      .prepare(
        `SELECT ip.id FROM inspections ip
         WHERE ip.part_id = @partId AND ip.type = 'in_process' ${jobFilter}
         ORDER BY (ip.status = 'approved') DESC, ip.date DESC, ip.id DESC
         LIMIT 1`
      )
      .get({ partId: inspection.part_id, jobNumber: inspection.job_number || null });
    if (linked) linkedInProcess = getInspectionDetail(linked.id);
  }

  return {
    ...inspection,
    measurements,
    pointSummaries,
    sampleRows,
    points,
    signature: signature || null,
    linkedInProcess,
  };
}

// GET /api/inspections/:id  (includes measurements + specs for each balloon)
router.get("/:id", attachRole, (req, res) => {
  const inspection = getInspectionDetail(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, inspection.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  res.json(inspection);
});

// GET /api/inspections/:id/audit  (chronological trail: audit_log + signatures, joined to users)
router.get("/:id/audit", (req, res) => {
  const entries = db
    .prepare(
      `SELECT a.id, a.action, a.details, a.created_at AS at, u.full_name AS user_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity_type = 'inspection' AND a.entity_id = ?
       UNION ALL
       SELECT s.id, ('signed_' || s.action) AS action, NULL AS details, s.signed_at AS at, u.full_name AS user_name
       FROM signatures s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.inspection_id = ?
       ORDER BY at ASC`
    )
    .all(req.params.id, req.params.id);

  res.json(
    entries.map((e) => ({ ...e, details: e.details ? JSON.parse(e.details) : null }))
  );
});

// POST /api/inspections  (creates the inspection; body: part_id or operation_id,
// drawing_id, type + optional header fields)
// Only one *open* (in_progress) Data Sheet per part+type at a time (scoped
// further by operation_id when set, so two different operations on the same
// part each get their own open in-process Data Sheet instead of resuming each
// other's): if one is already open it's resumed instead of creating a
// duplicate. Once a Data Sheet is signed (approved/rejected) it's locked
// history, and the next click starts a new one.
router.post("/", attachRole, (req, res) => {
  const { drawing_id, type } = req.body;
  let { part_id, operation_id } = req.body;
  if (!type) return res.status(400).json({ error: "type is required" });
  if (!canAccessType(req.user.role, type)) {
    return res.status(403).json({ error: "Operators can only create or edit In-Process Data Sheets." });
  }

  if (operation_id) {
    // Never trust a client-supplied part_id when operation_id is set --
    // resolve it from the operation itself, so the two can't mismatch (same
    // pattern as POST /api/drawings).
    const operation = db.prepare("SELECT part_id, scope FROM operations WHERE id = ?").get(operation_id);
    if (!operation) return res.status(404).json({ error: "Operation not found" });
    // Set-up, the Operator's In-Process list, QC's own separate In-Process
    // list, and Samples are four independent operation lists (see
    // schema.sql's operations.scope comment) -- the UI only ever offers the
    // matching one, this is the API-level backstop against an operation_id
    // from the wrong list being used to create an inspection.
    if (type === "setup" && operation.scope !== "setup") {
      return res.status(400).json({ error: "This operation isn't in the Set-up list." });
    }
    if (type === "samples" && operation.scope !== "samples") {
      return res.status(400).json({ error: "This operation isn't in the Samples list." });
    }
    if (type === "in_process") {
      if (!["in_process_operator", "in_process_qc"].includes(operation.scope)) {
        return res.status(400).json({ error: "This operation isn't in an In-Process list." });
      }
      // A genuine Operator account may only use the Operator's own list, not
      // QC's -- QC/Engineer/Admin may use either. Can't be tightened further
      // for an admin previewing "View as Operator", since that's a
      // frontend-only preview and req.user.role is still their real role here.
      if (req.user.role === "operator" && operation.scope !== "in_process_operator") {
        return res.status(400).json({ error: "This operation isn't in the Operator's In-Process list." });
      }
    }
    part_id = operation.part_id;
  } else if (!part_id) {
    return res.status(400).json({ error: "part_id is required (or operation_id)" });
  }

  const openExisting = operation_id
    ? db
        .prepare("SELECT * FROM inspections WHERE part_id = ? AND type = ? AND operation_id = ? AND status = 'in_progress'")
        .get(part_id, type, operation_id)
    : db
        .prepare("SELECT * FROM inspections WHERE part_id = ? AND type = ? AND operation_id IS NULL AND status = 'in_progress'")
        .get(part_id, type);
  if (openExisting) return res.json(openExisting);

  const part = db
    .prepare(`SELECT p.*, c.name AS client_name FROM parts p JOIN clients c ON c.id = p.client_id WHERE p.id = ?`)
    .get(part_id);
  if (!part) return res.status(404).json({ error: "Part not found" });
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, part.client_id)) {
    return res.status(403).json({
      error: "You're not assigned to this customer. Ask an admin to assign it to you in Admin > Users.",
    });
  }

  // hundred_percent_inspection (and machine_log_mode below) is set once at
  // template setup (see PUT /api/drawings/:id), not per-inspection -- every
  // new Data Sheet created against this drawing inherits it, same as it
  // inherits the Find# columns themselves. Copied onto the inspection row
  // (not read live via a join later) so an already-created Data Sheet keeps
  // whatever was true when it was started, even if the template's setting
  // changes afterward.
  const drawingDefaults = drawing_id
    ? db.prepare("SELECT hundred_percent_inspection, machine_log_mode FROM balloon_drawings WHERE id = ?").get(drawing_id)
    : null;

  const columns = ["part_id", "drawing_id", "type", "operation_id", "created_by", "updated_by", ...HEADER_FIELDS];
  const values = [
    part_id,
    drawing_id || null,
    type,
    operation_id || null,
    req.user.id,
    req.user.id,
    // "customer" defaults to the customer folder this part lives under —
    // still just a free-text field afterward, in case the paper form's
    // customer ever needs to differ from the client record (e.g. drop-ship).
    ...HEADER_FIELDS.map((f) => {
      if (f === "customer") return req.body.customer ?? part.client_name;
      if (f === "hundred_percent_inspection") {
        return req.body.hundred_percent_inspection !== undefined
          ? req.body.hundred_percent_inspection
            ? 1
            : 0
          : drawingDefaults?.hundred_percent_inspection
            ? 1
            : 0;
      }
      if (f === "machine_log_mode") {
        return req.body.machine_log_mode !== undefined
          ? req.body.machine_log_mode
            ? 1
            : 0
          : drawingDefaults?.machine_log_mode
            ? 1
            : 0;
      }
      // NOT NULL columns -- always resolve to a concrete 0/1, never null.
      if (BOOLEAN_HEADER_FIELDS.includes(f)) return req.body[f] ? 1 : 0;
      return req.body[f] ?? null;
    }),
  ];

  const result = db
    .prepare(
      `INSERT INTO inspections (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    )
    .run(...values);

  recordAudit("inspection", result.lastInsertRowid, "created", req.user.id, { type, part_id, operation_id: operation_id || null });

  const inspection = db.prepare("SELECT * FROM inspections WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(inspection);
});

// PUT /api/inspections/:id  (updates header fields: customer, heat, quantity, supplier,
// po_number, customer_po_number, operation, job_number, inspector, sampling plan,
// lot_disposition, notes, date)
router.put("/:id", attachRole, (req, res) => {
  const existing = db
    .prepare("SELECT i.*, p.client_id FROM inspections i JOIN parts p ON p.id = i.part_id WHERE i.id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Inspection not found" });
  if (!canAccessType(req.user.role, existing.type)) {
    return res.status(403).json({ error: "Operators can only create or edit In-Process Data Sheets." });
  }
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, existing.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  if (existing.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }

  // "date" is the manually-entered inspection date (not a creation timestamp),
  // so it's editable here alongside the rest of the header — kept out of
  // HEADER_FIELDS since that list is also used by POST, where "date" should
  // never be forced to NULL just because the client didn't send one.
  const fields = [...HEADER_FIELDS, "date"];

  // Normalize to 0/1 only when actually sent, so an omitted field still falls
  // through the COALESCE below as "leave it alone" (undefined), not "clear it".
  BOOLEAN_HEADER_FIELDS.forEach((f) => {
    if (req.body[f] !== undefined) req.body[f] = req.body[f] ? 1 : 0;
  });

  const changes = {};
  fields.forEach((f) => {
    if (req.body[f] !== undefined && req.body[f] !== existing[f]) {
      changes[f] = { old: existing[f], new: req.body[f] };
    }
  });

  const setClauses = fields.map((f) => `${f} = COALESCE(@${f}, ${f})`).join(", ");
  const values = { id: req.params.id, updated_by: req.user.id };
  fields.forEach((f) => {
    values[f] = req.body[f] ?? null;
  });

  db.prepare(`UPDATE inspections SET ${setClauses}, updated_by = @updated_by WHERE id = @id`).run(values);

  if (Object.keys(changes).length > 0) {
    recordHeaderAudit("inspection", req.params.id, req.user.id, changes);
  }

  res.json(db.prepare("SELECT * FROM inspections WHERE id = ?").get(req.params.id));
});

// PUT /api/inspections/:id/measurements  (saves/updates measurements in batch)
// body: { measurements: [{ balloon_point_id, sample_number, measured_value }, ...] }
router.put("/:id/measurements", attachRole, (req, res) => {
  const inspection = db
    .prepare("SELECT i.status, i.type, p.client_id FROM inspections i JOIN parts p ON p.id = i.part_id WHERE i.id = ?")
    .get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (!canAccessType(req.user.role, inspection.type)) {
    return res.status(403).json({ error: "Operators can only create or edit In-Process Data Sheets." });
  }
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, inspection.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  if (inspection.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }

  const { measurements } = req.body;
  if (!Array.isArray(measurements)) return res.status(400).json({ error: "measurements must be an array" });

  const getExisting = db.prepare(
    "SELECT measured_value FROM measurements WHERE inspection_id = ? AND balloon_point_id = ? AND sample_number = ?"
  );

  const upsert = db.prepare(`
    INSERT INTO measurements (inspection_id, balloon_point_id, sample_number, measured_value, within_tolerance)
    VALUES (@inspection_id, @balloon_point_id, @sample_number, @measured_value, @within_tolerance)
    ON CONFLICT(inspection_id, balloon_point_id, sample_number)
    DO UPDATE SET measured_value = excluded.measured_value, within_tolerance = excluded.within_tolerance
  `);

  const getPoint = db.prepare("SELECT * FROM balloon_points WHERE id = ?");

  const changes = [];

  const tx = db.transaction((items) => {
    for (const item of items) {
      const point = getPoint.get(item.balloon_point_id);
      const sampleNumber = item.sample_number ?? 1;
      const withinTolerance = computeWithinTolerance(point, item.measured_value);

      const existing = getExisting.get(req.params.id, item.balloon_point_id, sampleNumber);
      if (!existing || existing.measured_value !== item.measured_value) {
        changes.push({
          balloon_number: point?.balloon_number,
          sample_number: sampleNumber,
          old_value: existing?.measured_value ?? null,
          new_value: item.measured_value,
        });
      }

      upsert.run({
        inspection_id: req.params.id,
        balloon_point_id: item.balloon_point_id,
        sample_number: sampleNumber,
        measured_value: item.measured_value,
        within_tolerance: withinTolerance,
      });
    }
  });

  tx(measurements);

  if (changes.length > 0) {
    recordMeasurementsAudit("inspection", req.params.id, req.user.id, changes);
  }

  const updated = db
    .prepare(
      `SELECT m.*, bp.balloon_number FROM measurements m
       JOIN balloon_points bp ON bp.id = m.balloon_point_id
       WHERE m.inspection_id = ? ORDER BY bp.balloon_number, m.sample_number`
    )
    .all(req.params.id);

  res.json(updated);
});

// PUT /api/inspections/:id/point-summaries  (100%-inspection tallies -- one row
// per Find# instead of one measurements row per sample; see schema.sql)
// body: { summaries: [{ balloon_point_id, qty_inspected, qty_rejected, reject_notes }, ...] }
router.put("/:id/point-summaries", attachRole, (req, res) => {
  const inspection = db
    .prepare("SELECT i.status, i.type, p.client_id FROM inspections i JOIN parts p ON p.id = i.part_id WHERE i.id = ?")
    .get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (!canAccessType(req.user.role, inspection.type)) {
    return res.status(403).json({ error: "Operators can only create or edit In-Process Data Sheets." });
  }
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, inspection.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  if (inspection.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }

  const { summaries } = req.body;
  if (!Array.isArray(summaries)) return res.status(400).json({ error: "summaries must be an array" });

  const getExistingSummary = db.prepare(
    "SELECT qty_inspected, qty_rejected, reject_notes FROM inspection_point_summaries WHERE inspection_id = ? AND balloon_point_id = ?"
  );
  const getPoint = db.prepare("SELECT balloon_number FROM balloon_points WHERE id = ?");

  const upsert = db.prepare(`
    INSERT INTO inspection_point_summaries (inspection_id, balloon_point_id, qty_inspected, qty_rejected, reject_notes)
    VALUES (@inspection_id, @balloon_point_id, @qty_inspected, @qty_rejected, @reject_notes)
    ON CONFLICT(inspection_id, balloon_point_id)
    DO UPDATE SET qty_inspected = excluded.qty_inspected, qty_rejected = excluded.qty_rejected,
      reject_notes = excluded.reject_notes
  `);

  // Diffed the same way as measurements below -- autosave fires this on every
  // ~900ms debounce, so without a real before/after diff (and the coalescing
  // recorder), History fills up with a near-duplicate row per keystroke burst.
  const changes = [];

  const tx = db.transaction((items) => {
    for (const item of items) {
      const qty_inspected = Number(item.qty_inspected) || 0;
      const qty_rejected = Number(item.qty_rejected) || 0;
      const reject_notes = item.reject_notes || null;

      const existing = getExistingSummary.get(req.params.id, item.balloon_point_id);
      if (
        !existing ||
        existing.qty_inspected !== qty_inspected ||
        existing.qty_rejected !== qty_rejected ||
        existing.reject_notes !== reject_notes
      ) {
        changes.push({
          balloon_number: getPoint.get(item.balloon_point_id)?.balloon_number,
          old: existing ?? null,
          new: { qty_inspected, qty_rejected, reject_notes },
        });
      }

      upsert.run({
        inspection_id: req.params.id,
        balloon_point_id: item.balloon_point_id,
        qty_inspected,
        qty_rejected,
        reject_notes,
      });
    }
  });
  tx(summaries);

  if (changes.length > 0) {
    recordPointSummariesAudit("inspection", req.params.id, req.user.id, changes);
  }

  const updated = db
    .prepare(
      `SELECT ips.*, bp.balloon_number FROM inspection_point_summaries ips
       JOIN balloon_points bp ON bp.id = ips.balloon_point_id
       WHERE ips.inspection_id = ? ORDER BY bp.sort_order`
    )
    .all(req.params.id);

  res.json(updated);
});

// PUT /api/inspections/:id/sample-rows  (machine_log_mode's per-row qty/
// machine #/comment -- one row per sample_number, alongside that sample's
// usual per-point measurements; see schema.sql)
// body: { sampleRows: [{ sample_number, qty, machine_number, comment }, ...] }
router.put("/:id/sample-rows", attachRole, (req, res) => {
  const inspection = db
    .prepare("SELECT i.status, i.type, p.client_id FROM inspections i JOIN parts p ON p.id = i.part_id WHERE i.id = ?")
    .get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (!canAccessType(req.user.role, inspection.type)) {
    return res.status(403).json({ error: "Operators can only create or edit In-Process Data Sheets." });
  }
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, inspection.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  if (inspection.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }

  const { sampleRows } = req.body;
  if (!Array.isArray(sampleRows)) return res.status(400).json({ error: "sampleRows must be an array" });

  const getExistingRow = db.prepare(
    "SELECT qty, machine_number, comment FROM inspection_sample_rows WHERE inspection_id = ? AND sample_number = ?"
  );

  const upsert = db.prepare(`
    INSERT INTO inspection_sample_rows (inspection_id, sample_number, qty, machine_number, comment)
    VALUES (@inspection_id, @sample_number, @qty, @machine_number, @comment)
    ON CONFLICT(inspection_id, sample_number)
    DO UPDATE SET qty = excluded.qty, machine_number = excluded.machine_number, comment = excluded.comment
  `);

  // Diffed the same way as point-summaries above -- autosave fires this on
  // every ~900ms debounce, so without a real before/after diff (and the
  // coalescing recorder), History fills up with a near-duplicate row per
  // keystroke burst.
  const changes = [];

  const tx = db.transaction((items) => {
    for (const item of items) {
      const sample_number = item.sample_number;
      const qty = item.qty === "" || item.qty == null ? null : Number(item.qty);
      const machine_number = item.machine_number || null;
      const comment = item.comment || null;

      const existing = getExistingRow.get(req.params.id, sample_number);
      if (!existing || existing.qty !== qty || existing.machine_number !== machine_number || existing.comment !== comment) {
        changes.push({
          sample_number,
          old: existing ?? null,
          new: { qty, machine_number, comment },
        });
      }

      upsert.run({ inspection_id: req.params.id, sample_number, qty, machine_number, comment });
    }
  });
  tx(sampleRows);

  if (changes.length > 0) {
    recordSampleRowsAudit("inspection", req.params.id, req.user.id, changes);
  }

  const updated = db
    .prepare("SELECT * FROM inspection_sample_rows WHERE inspection_id = ? ORDER BY sample_number")
    .all(req.params.id);

  res.json(updated);
});

// DELETE /api/inspections/:id/measurements/:sampleNumber  (removes one sample row)
router.delete("/:id/measurements/:sampleNumber", attachRole, (req, res) => {
  const inspection = db
    .prepare("SELECT i.status, i.type, p.client_id FROM inspections i JOIN parts p ON p.id = i.part_id WHERE i.id = ?")
    .get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (!canAccessType(req.user.role, inspection.type)) {
    return res.status(403).json({ error: "Operators can only create or edit In-Process Data Sheets." });
  }
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, inspection.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  if (inspection.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }

  db.prepare("DELETE FROM inspection_sample_rows WHERE inspection_id = ? AND sample_number = ?").run(
    req.params.id,
    Number(req.params.sampleNumber)
  );

  db.prepare("DELETE FROM measurements WHERE inspection_id = ? AND sample_number = ?").run(
    req.params.id,
    Number(req.params.sampleNumber)
  );

  recordAudit("inspection", req.params.id, "sample_deleted", req.user.id, {
    sample_number: req.params.sampleNumber,
  });

  res.status(204).send();
});

// GET /api/inspections/:id/photos -- optional supporting photos (e.g. a
// non-conformance or visual reference), surfaced by the frontend on Final
// Inspection only, but not restricted to that type here (see schema.sql's
// inspection_photos comment).
router.get("/:id/photos", (req, res) => {
  const photos = db
    .prepare(
      `SELECT p.*, u.full_name AS uploaded_by_name
       FROM inspection_photos p
       LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.inspection_id = ?
       ORDER BY p.created_at ASC`
    )
    .all(req.params.id);
  res.json(photos);
});

// POST /api/inspections/:id/photos  (multipart/form-data: image required, caption optional)
router.post("/:id/photos", attachRole, uploadPhoto.single("image"), (req, res) => {
  const inspection = db
    .prepare("SELECT i.status, i.type, p.client_id FROM inspections i JOIN parts p ON p.id = i.part_id WHERE i.id = ?")
    .get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (!canAccessType(req.user.role, inspection.type)) {
    return res.status(403).json({ error: "Operators can only create or edit In-Process Data Sheets." });
  }
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, inspection.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  if (inspection.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }
  if (!req.file) return res.status(400).json({ error: "An image file is required." });

  const { caption } = req.body;
  const result = db
    .prepare("INSERT INTO inspection_photos (inspection_id, image_path, caption, uploaded_by) VALUES (?, ?, ?, ?)")
    .run(req.params.id, `/uploads/${req.file.filename}`, caption?.trim() || null, req.user.id);

  recordAudit("inspection", req.params.id, "photo_uploaded", req.user.id, { photo_id: result.lastInsertRowid });

  const photo = db.prepare("SELECT * FROM inspection_photos WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(photo);
});

// DELETE /api/inspections/:id/photos/:photoId
router.delete("/:id/photos/:photoId", attachRole, (req, res) => {
  const inspection = db
    .prepare("SELECT i.status, i.type, p.client_id FROM inspections i JOIN parts p ON p.id = i.part_id WHERE i.id = ?")
    .get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (!canAccessType(req.user.role, inspection.type)) {
    return res.status(403).json({ error: "Operators can only create or edit In-Process Data Sheets." });
  }
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, inspection.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }
  if (inspection.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
  }

  const result = db
    .prepare("DELETE FROM inspection_photos WHERE id = ? AND inspection_id = ?")
    .run(req.params.photoId, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Photo not found" });

  recordAudit("inspection", req.params.id, "photo_deleted", req.user.id, { photo_id: Number(req.params.photoId) });
  res.status(204).send();
});

// Shared guard for cert upload/delete: certs only belong on Incoming
// Inspection, and like photos they freeze once the Data Sheet is signed.
function checkCertEditable(req, res) {
  const inspection = db.prepare("SELECT status, type FROM inspections WHERE id = ?").get(req.params.id);
  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return false;
  }
  if (inspection.type !== "incoming") {
    res.status(400).json({ error: "Certs can only be attached to Incoming Inspection Data Sheets." });
    return false;
  }
  if (!canAccessType(req.user.role, inspection.type)) {
    res.status(403).json({ error: "Operators can only create or edit In-Process Data Sheets." });
    return false;
  }
  if (inspection.status !== "in_progress") {
    res.status(409).json({ error: "This Data Sheet has been signed and can no longer be edited." });
    return false;
  }
  return true;
}

// GET /api/inspections/:id/certs
router.get("/:id/certs", (req, res) => {
  const certs = db
    .prepare(
      `SELECT c.*, u.full_name AS uploaded_by_name
       FROM inspection_certs c
       LEFT JOIN users u ON u.id = c.uploaded_by
       WHERE c.inspection_id = ?
       ORDER BY c.created_at ASC, c.id ASC`
    )
    .all(req.params.id);
  res.json(certs);
});

// POST /api/inspections/:id/certs  (multipart/form-data: file required, PDF only)
router.post(
  "/:id/certs",
  attachRole,
  (req, res, next) => {
    if (checkCertEditable(req, res)) next();
  },
  (req, res, next) => {
    uploadCert.single("file")(req, res, (err) => {
      if (!err) return next();
      const message =
        err.code === "LIMIT_FILE_SIZE" ? "Cert PDFs must be 25 MB or smaller." : err.message || "Upload failed.";
      res.status(400).json({ error: message });
    });
  },
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "A PDF file is required." });

    const result = db
      .prepare("INSERT INTO inspection_certs (inspection_id, file_path, original_name, uploaded_by) VALUES (?, ?, ?, ?)")
      .run(req.params.id, `/uploads/${req.file.filename}`, req.file.originalname, req.user.id);

    recordAudit("inspection", req.params.id, "cert_uploaded", req.user.id, {
      cert_id: result.lastInsertRowid,
      file_name: req.file.originalname,
    });

    const cert = db
      .prepare(
        `SELECT c.*, u.full_name AS uploaded_by_name
         FROM inspection_certs c LEFT JOIN users u ON u.id = c.uploaded_by
         WHERE c.id = ?`
      )
      .get(result.lastInsertRowid);
    res.status(201).json(cert);
  }
);

// DELETE /api/inspections/:id/certs/:certId
router.delete("/:id/certs/:certId", attachRole, (req, res) => {
  if (!checkCertEditable(req, res)) return;

  const cert = db
    .prepare("SELECT original_name FROM inspection_certs WHERE id = ? AND inspection_id = ?")
    .get(req.params.certId, req.params.id);
  if (!cert) return res.status(404).json({ error: "Cert not found" });

  db.prepare("DELETE FROM inspection_certs WHERE id = ?").run(req.params.certId);
  recordAudit("inspection", req.params.id, "cert_deleted", req.user.id, {
    cert_id: Number(req.params.certId),
    file_name: cert.original_name,
  });
  res.status(204).send();
});

// PUT /api/inspections/:id/status  (approve/reject, requires an electronic-signature confirmation)
// body: { status: 'approved' | 'conditionally_approved' | 'rejected', signer_name: string, reason?: string }
// 'conditionally_approved' is a UI-facing result only -- signatures.action and
// inspections.status have no such value (both stay a plain 'approved' CHECK
// enum), so it's stored as status='approved' plus a required conditional_reason.
// Operators can also sign, but only their own In-Process Data Sheets -- ones
// created under an 'in_process_operator' operation for a customer they're
// assigned to. QC's In-Process ('in_process_qc'), Set-up, Final, etc. stay
// QC/admin/supervisor only.
router.put("/:id/status", attachRole, (req, res) => {
  const { status, signer_name, reason } = req.body;
  const role = req.user.role;
  if (role === "operator") {
    const target = db
      .prepare(
        `SELECT i.type, p.client_id, o.scope AS operation_scope
         FROM inspections i
         JOIN parts p ON p.id = i.part_id
         LEFT JOIN operations o ON o.id = i.operation_id
         WHERE i.id = ?`
      )
      .get(req.params.id);
    if (!target) return res.status(404).json({ error: "Inspection not found" });
    if (target.type !== "in_process" || target.operation_scope !== "in_process_operator") {
      return res.status(403).json({ error: "Operators can only sign Operator In-Process Data Sheets." });
    }
    if (!isAssignedToClient(req.user.id, target.client_id)) {
      return res.status(403).json({ error: "You're not assigned to this customer." });
    }
  } else if (!["qc", "admin", "supervisor"].includes(role)) {
    return res.status(403).json({ error: "You don't have permission to sign Data Sheets." });
  }
  if (!["approved", "conditionally_approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be 'approved', 'conditionally_approved', or 'rejected'" });
  }
  if (status === "conditionally_approved" && !reason?.trim()) {
    return res.status(400).json({ error: "reason is required to conditionally approve this Data Sheet" });
  }

  const existing = db
    .prepare("SELECT status, inspector, type, part_id, job_number, requires_in_process FROM inspections WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Inspection not found" });
  if (existing.status !== "in_progress") {
    return res.status(409).json({ error: "This Data Sheet has already been signed." });
  }

  // The "Operator In-Process Data Sheet required" gate only blocks an actual
  // pass (plain or conditional) -- QC can always reject a part regardless,
  // since that isn't claiming the in-process check happened.
  if (status !== "rejected" && existing.type === "final" && existing.requires_in_process) {
    if (!hasQualifyingInProcess(existing.part_id, existing.job_number)) {
      return res.status(409).json({
        error:
          "This Final Inspection is marked as requiring an Operator In-Process Data Sheet, but none has been recorded yet for this part" +
          (existing.job_number ? ` and WO# ${existing.job_number}` : "") +
          ".",
      });
    }
  }

  if (!existing.inspector || !existing.inspector.trim()) {
    return res.status(400).json({
      error: "Set and save the inspector name (By) before approving or rejecting this Data Sheet.",
    });
  }

  if (!signer_name || signer_name.trim().toLowerCase() !== req.user.full_name.trim().toLowerCase()) {
    return res.status(400).json({ error: "signer_name must match your logged-in full name to sign" });
  }

  const dbStatus = status === "conditionally_approved" ? "approved" : status;
  const conditionalReason = status === "conditionally_approved" ? reason.trim() : null;

  signInspectionStatus(db, { inspectionId: req.params.id, userId: req.user.id, status: dbStatus, conditionalReason });
  recordAudit("inspection", req.params.id, "status_changed", req.user.id, { status, reason: conditionalReason });

  const inspection = db.prepare("SELECT * FROM inspections WHERE id = ?").get(req.params.id);
  res.json(inspection);
});

// PUT /api/inspections/:id/unlock  (reopens an already-signed Data Sheet for
// editing by setting status back to in_progress) -- same admin/supervisor
// restriction as DELETE /:id below, since this is the non-destructive
// alternative to it: instead of erasing a signed sheet that turns out to
// need a correction, reopen it, fix it, and re-sign. Doesn't touch the
// signatures table -- the old signature row is left exactly as it was (the
// trg_status_requires_signature/trg_signature_requires_status triggers in
// schema.sql only constrain moving TO approved/rejected, not back to
// in_progress), so re-signing afterward just adds a new signature row on
// top and the full before/after signing history stays visible via the
// audit log and the signatures table, even though getInspectionDetail's
// "most recent wins" read only ever surfaces the latest one as *the*
// signature shown on the report.
router.put("/:id/unlock", attachRole, requireRole("admin", "supervisor"), (req, res) => {
  const inspection = db.prepare("SELECT status FROM inspections WHERE id = ?").get(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (inspection.status === "in_progress") {
    return res.status(409).json({ error: "This Data Sheet is already open for editing." });
  }

  db.prepare("UPDATE inspections SET status = 'in_progress', updated_by = ? WHERE id = ?").run(
    req.user.id,
    req.params.id
  );
  recordAudit("inspection", req.params.id, "unlocked", req.user.id, { previous_status: inspection.status });

  res.json(db.prepare("SELECT * FROM inspections WHERE id = ?").get(req.params.id));
});

// DELETE /api/inspections/:id  (cascades to its measurements and signatures)
// Deliberately narrower than every other write route on this file -- QC can
// create/edit/sign a Data Sheet but not erase an already-saved one. Only
// admin and supervisor (a role that exists mainly for this) can delete any
// sheet. The one exception is a blank sheet (IS_BLANK_SQL -- opened but
// nothing ever recorded): QC can discard any of those, and an Operator can
// discard their own Operator In-Process ones for an assigned customer.
router.delete("/:id", attachRole, (req, res) => {
  const role = req.user.role;
  const target = db
    .prepare(
      `SELECT i.id, i.type, p.client_id, o.scope AS operation_scope, ${IS_BLANK_SQL} AS is_blank
       FROM inspections i
       JOIN parts p ON p.id = i.part_id
       LEFT JOIN operations o ON o.id = i.operation_id
       WHERE i.id = ?`
    )
    .get(req.params.id);
  if (!target) return res.status(404).json({ error: "Inspection not found" });

  if (!["admin", "supervisor"].includes(role)) {
    if (role === "operator") {
      if (target.type !== "in_process" || target.operation_scope !== "in_process_operator") {
        return res.status(403).json({ error: "Operators can only discard their own In-Process Data Sheets." });
      }
      if (!isAssignedToClient(req.user.id, target.client_id)) {
        return res.status(403).json({ error: "You're not assigned to this customer." });
      }
    } else if (role !== "qc") {
      return res.status(403).json({ error: "You don't have permission to delete Data Sheets." });
    }
    if (!target.is_blank) {
      return res.status(409).json({
        error:
          "This Data Sheet already has recorded data, so it can't be discarded. Ask an admin or supervisor to delete it.",
      });
    }
  }

  // Leaves a trace in audit_log (keyed to the now-gone id) of who removed it.
  recordAudit("inspection", target.id, "deleted", req.user.id, { blank: !!target.is_blank, type: target.type });
  db.prepare("DELETE FROM inspections WHERE id = ?").run(target.id);
  res.status(204).send();
});

// GET /api/inspections/:id/pdf  (renders the Data Sheet as a downloadable PDF)
router.get("/:id/pdf", attachRole, (req, res) => {
  const inspection = getInspectionDetail(req.params.id);
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (req.user.role === "operator" && !isAssignedToClient(req.user.id, inspection.client_id)) {
    return res.status(403).json({ error: "You're not assigned to this customer." });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="inspection-${inspection.id}.pdf"`);
  generateInspectionPdf(res, inspection);
});

module.exports = router;
