// User-facing identifier for an inspection: Part# — WO# — Date. The DB id is
// still used for routing, but never shown as the label.
export function inspectionLabel(inspection) {
  const partNumber = inspection.part_number || `Part #${inspection.part_id}`;
  return `${partNumber} — ${orderRefLabel(inspection) ?? `${orderRefKind(inspection)} —`} — ${formatDate(inspection.date)}`;
}

// The order an inspection is tracked by: Incoming material comes in on a
// supplier's PO# (inspections.po_number), everything else runs on a shop
// Job#/WO# (inspections.job_number). Matches the Data Sheet header fields.
export function orderRefKind(inspection) {
  return inspection.type === "incoming" ? "PO#" : "WO#";
}

export function orderRefValue(inspection) {
  return (inspection.type === "incoming" ? inspection.po_number : inspection.job_number) || null;
}

// "PO# 96664" / "WO# 9777", or null when none was entered.
export function orderRefLabel(inspection) {
  const value = orderRefValue(inspection);
  return value ? `${orderRefKind(inspection)} ${value}` : null;
}

// MM/DD/YYYY for an inspection/header date ("YYYY-MM-DD", or a legacy
// "YYYY-MM-DD HH:MM:SS"). Rearranges the stored calendar date as text rather
// than going through Date, so it can never shift a day across time zones.
// The backend PDF (src/pdf/inspectionSheet.js formatDate) mirrors this.
export function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!m) return value ? String(value) : "—";
  return `${m[2]}/${m[3]}/${m[1]}`;
}

// 'conditionally_approved' isn't a real inspections.status value (see PUT
// /:id/status in the backend) -- it's status='approved' with a
// conditional_reason attached, so every badge/result display has to derive
// it the same way instead of reading inspection.status directly.
export function resultStatus(inspection) {
  if (inspection.status === "approved" && inspection.conditional_reason) return "conditionally_approved";
  return inspection.status;
}

const RESULT_LABELS = {
  in_progress: "In progress",
  approved: "Approved",
  conditionally_approved: "Conditionally approved",
  rejected: "Rejected",
};

export function resultLabel(result) {
  return RESULT_LABELS[result] ?? result;
}

// inspections.type -- see CLAUDE.md's data model notes: 'quote'/'other'
// exist in the CHECK constraint but aren't reachable from the UI, so they're
// not listed here.
export const TYPE_LABELS = {
  incoming: "Incoming",
  setup: "Set-up",
  in_process: "In-Process",
  final: "Final",
  samples: "Samples",
};

export function typeLabel(type) {
  return TYPE_LABELS[type] ?? type;
}

// Display text only -- the underlying role value ('engineer' etc., see
// schema.sql's users.role CHECK) is unchanged, so this is safe to reword
// anytime without a migration.
export const ROLE_LABELS = {
  qc: "QC Inspector",
  operator: "Operator",
  engineer: "Quality Analytics",
  supervisor: "Supervisor",
  admin: "Admin",
};

// Absolute date + time for a SQLite UTC "YYYY-MM-DD HH:MM:SS" timestamp --
// same parsing as timeAgo above, just rendered as a fixed date instead of a
// relative one (e.g. inspection sheet header dates, user last-login/created).
export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Time-of-day greeting for the Home dashboard header.
export function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Short relative time for the Home dashboard's recent-activity feed (e.g.
// "2h ago"). value is a SQLite UTC "YYYY-MM-DD HH:MM:SS" timestamp with no
// timezone marker -- same parsing as formatDateTime in InspectionSheet.jsx,
// just rendered as "X ago" instead of an absolute date. Falls back to a
// plain date once it's more than a week old, since "9d ago" is less useful
// than the actual date at that point.
export function timeAgo(value) {
  if (!value) return "—";
  const then = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(then.getTime())) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
