const express = require("express");
const db = require("../db");
const { getInspectionDetail } = require("./inspections");
const { performedBySql } = require("../lib/performedBy");
const { flagSheet, isFlagged } = require("../lib/sheetFlags");
const { getResult } = require("../pdf/inspectionSheet");

// Inspector Performance (QA Manager + admin only, see index.js): how many
// Data Sheets each QC Inspector / Operator performs per day, how their
// sheets turned out, and which ones the automatic checks in
// lib/sheetFlags.js think deserve a second look. A sheet is credited to
// whoever performed it (lib/performedBy.js), not whoever opened it.
const router = express.Router();

// ?role= filter -> which users' sheets count. "all" (QC + Operators, the
// people whose inspection work this page is mainly for) stays the default;
// the rest let a QA Manager look at any other role, or everyone at once.
const ROLE_SCOPES = {
  all: ["qc", "operator"],
  qc: ["qc"],
  operator: ["operator"],
  supervisor: ["supervisor"],
  qa_manager: ["qa_manager"],
  engineer: ["engineer"],
  admin: ["admin"],
  everyone: ["operator", "engineer", "qc", "supervisor", "qa_manager", "admin"],
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const EDIT_ACTIONS = new Set(["measurements_saved", "point_summaries_saved", "sample_rows_saved", "header_updated", "sample_deleted"]);

// Server-local YYYY-MM-DD -- inspections.date is a local date (see
// getInspectionDetail's retired-Find# rule), so ranges are local days too.
function localDay(d = new Date()) {
  return d.toLocaleDateString("en-CA");
}

function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function parseRange(query) {
  const today = localDay();
  let to = DAY_RE.test(query.to || "") ? query.to : today;
  let from = DAY_RE.test(query.from || "") ? query.from : addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (addDays(from, MAX_RANGE_DAYS - 1) < to) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to, today };
}

function daysInRange(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

// SQLite UTC "YYYY-MM-DD HH:MM:SS" -> epoch ms.
function utcMs(ts) {
  return ts ? Date.parse(`${ts.replace(" ", "T")}Z`) : NaN;
}

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Every non-blank sheet dated in range that an in-scope user performed,
// with its flags. `userId` narrows to one person (whatever their role now).
function loadSheets({ from, to, today, roles, userId }) {
  const rows = db
    .prepare(
      `SELECT x.id, x.performer_id
       FROM (
         SELECT i.id, ${performedBySql("i")} AS performer_id
         FROM inspections i
         WHERE substr(i.date, 1, 10) BETWEEN ? AND ?
       ) x
       JOIN users u ON u.id = x.performer_id
       WHERE ${
         userId
           ? "u.id = ?"
           : // Main role or any additional one (user_roles, see lib/roles.js).
             `(u.role IN (SELECT value FROM json_each(@roles))
               OR EXISTS (SELECT 1 FROM user_roles ur
                          WHERE ur.user_id = u.id AND ur.role IN (SELECT value FROM json_each(@roles))))`
       }`
    )
    .all(from, to, userId ? userId : { roles: JSON.stringify(roles) });
  if (rows.length === 0) return [];

  const auditRows = db
    .prepare(
      `SELECT a.entity_id, a.action, a.user_id, u.full_name, COUNT(*) AS n, MIN(a.created_at) AS first_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity_type = 'inspection' AND a.entity_id IN (SELECT value FROM json_each(?))
       GROUP BY a.entity_id, a.action, a.user_id`
    )
    .all(JSON.stringify(rows.map((r) => r.id)));
  const auditBySheet = new Map();
  for (const a of auditRows) {
    if (!auditBySheet.has(a.entity_id)) auditBySheet.set(a.entity_id, []);
    auditBySheet.get(a.entity_id).push(a);
  }

  const sheets = [];
  for (const { id, performer_id } of rows) {
    const inspection = getInspectionDetail(id);
    if (!inspection) continue;
    const blank =
      inspection.measurements.length === 0 && inspection.pointSummaries.length === 0 && inspection.sampleRows.length === 0;
    if (blank && inspection.status === "in_progress") continue;

    const audit = auditBySheet.get(id) || [];
    const unlocks = audit.filter((a) => a.action === "unlocked").reduce((n, a) => n + a.n, 0);
    const otherEditors = [
      ...new Set(
        audit.filter((a) => EDIT_ACTIONS.has(a.action) && a.user_id !== performer_id && a.full_name).map((a) => a.full_name)
      ),
    ];
    // Time from the first edit to the (latest) signature -- includes any
    // rework after a reopen, which is part of what it cost to finish.
    const startedAt = Math.min(...audit.filter((a) => EDIT_ACTIONS.has(a.action)).map((a) => utcMs(a.first_at)));
    const signedAt = utcMs(inspection.signature?.signed_at);
    const minutesToSign =
      Number.isFinite(startedAt) && Number.isFinite(signedAt) && signedAt >= startedAt
        ? Math.round((signedAt - startedAt) / 60_000)
        : null;

    const flags = flagSheet(inspection, { unlocks, otherEditors }, today);
    sheets.push({
      id,
      performer_id,
      day: String(inspection.date).slice(0, 10),
      date: inspection.date,
      type: inspection.type,
      status: inspection.status,
      result: getResult(inspection),
      conditional_reason: inspection.conditional_reason,
      part_number: inspection.part_number,
      client_name: inspection.client_name,
      operation_name: inspection.operation_name || inspection.operation || null,
      operation_scope: inspection.operation_scope,
      job_number: inspection.job_number,
      po_number: inspection.po_number,
      // Grid values plus check-column tallies (one Qty Inspected/Rejected
      // entry per Find#) -- a tally-only sheet would otherwise show 0.
      readings:
        inspection.measurements.filter((m) => m.measured_value != null && m.measured_value !== "").length +
        inspection.pointSummaries.length,
      out_of_tolerance: inspection.measurements.filter((m) => m.within_tolerance === 0).length,
      minutes_to_sign: minutesToSign,
      flags,
      flagged: isFlagged(flags),
    });
  }
  return sheets;
}

function summarize(sheets) {
  const activeDays = new Set(sheets.map((s) => s.day)).size;
  const flagCounts = {};
  for (const s of sheets) for (const f of s.flags) if (f.severity !== "info") flagCounts[f.code] = (flagCounts[f.code] || 0) + 1;
  return {
    sheets: sheets.length,
    signed: sheets.filter((s) => s.status !== "in_progress").length,
    approved: sheets.filter((s) => s.result === "approved").length,
    conditional: sheets.filter((s) => s.result === "conditionally_approved").length,
    rejected: sheets.filter((s) => s.result === "rejected").length,
    in_progress: sheets.filter((s) => s.status === "in_progress").length,
    readings: sheets.reduce((n, s) => n + s.readings, 0),
    active_days: activeDays,
    per_active_day: activeDays ? sheets.length / activeDays : 0,
    flagged_sheets: sheets.filter((s) => s.flagged).length,
    error_sheets: sheets.filter((s) => s.flags.some((f) => f.severity === "error")).length,
    flag_counts: flagCounts,
    median_minutes_to_sign: median(sheets.map((s) => s.minutes_to_sign).filter((m) => m != null)),
    last_day: sheets.reduce((d, s) => (s.day > d ? s.day : d), ""),
  };
}

// GET /api/inspector-analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&role=all|qc|operator
router.get("/", (req, res) => {
  const range = parseRange(req.query);
  const roleKey = ROLE_SCOPES[req.query.role] ? req.query.role : "all";
  const sheets = loadSheets({ ...range, roles: ROLE_SCOPES[roleKey] });

  const byUser = new Map();
  for (const s of sheets) {
    if (!byUser.has(s.performer_id)) byUser.set(s.performer_id, []);
    byUser.get(s.performer_id).push(s);
  }
  const users = byUser.size
    ? db
        .prepare(
          `SELECT id, full_name, role, active,
                  (SELECT json_group_array(role) FROM user_roles WHERE user_id = users.id) AS extra_roles
           FROM users WHERE id IN (SELECT value FROM json_each(?))`
        )
        .all(JSON.stringify([...byUser.keys()]))
    : [];
  const inspectors = users
    .map((u) => ({
      user_id: u.id,
      full_name: u.full_name,
      role: u.role,
      extra_roles: JSON.parse(u.extra_roles || "[]"),
      active: !!u.active,
      ...summarize(byUser.get(u.id)),
    }))
    .sort((a, b) => b.sheets - a.sheets || a.full_name.localeCompare(b.full_name));

  const countByDay = {};
  const flaggedByDay = {};
  for (const s of sheets) {
    countByDay[s.day] = (countByDay[s.day] || 0) + 1;
    if (s.flagged) flaggedByDay[s.day] = (flaggedByDay[s.day] || 0) + 1;
  }
  const daily = daysInRange(range.from, range.to).map((d) => ({ date: d, count: countByDay[d] || 0, flagged: flaggedByDay[d] || 0 }));

  res.json({ from: range.from, to: range.to, role: roleKey, totals: summarize(sheets), inspectors, daily });
});

// GET /api/inspector-analytics/:userId?from=&to=
router.get("/:userId", (req, res) => {
  const userId = Number(req.params.userId);
  const user = Number.isInteger(userId)
    ? db.prepare("SELECT id, username, full_name, role, active FROM users WHERE id = ?").get(userId)
    : null;
  if (!user) return res.status(404).json({ error: "User not found" });

  const range = parseRange(req.query);
  const sheets = loadSheets({ ...range, userId }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));

  const countByDay = {};
  const flaggedByDay = {};
  for (const s of sheets) {
    countByDay[s.day] = (countByDay[s.day] || 0) + 1;
    if (s.flagged) flaggedByDay[s.day] = (flaggedByDay[s.day] || 0) + 1;
  }
  const daily = daysInRange(range.from, range.to).map((d) => ({ date: d, count: countByDay[d] || 0, flagged: flaggedByDay[d] || 0 }));

  res.json({
    from: range.from,
    to: range.to,
    user: {
      ...user,
      extra_roles: db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(userId).map((r) => r.role),
      active: !!user.active,
    },
    summary: summarize(sheets),
    daily,
    sheets,
  });
});

module.exports = router;
