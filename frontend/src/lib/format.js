// User-facing identifier for an inspection: Part# — WO# — Date. The DB id is
// still used for routing, but never shown as the label.
export function inspectionLabel(inspection) {
  const partNumber = inspection.part_number || `Part #${inspection.part_id}`;
  const wo = inspection.job_number ? `WO# ${inspection.job_number}` : "WO# —";
  const date = inspection.date ? inspection.date.slice(0, 10) : "—";
  return `${partNumber} — ${wo} — ${date}`;
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

export const ROLE_LABELS = { qc: "QC Inspector", operator: "Operator", engineer: "Engineer", admin: "Admin" };

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
