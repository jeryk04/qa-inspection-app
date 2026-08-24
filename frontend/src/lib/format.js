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
