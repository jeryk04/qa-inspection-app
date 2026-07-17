// User-facing identifier for an inspection: Part# — WO# — Date. The DB id is
// still used for routing, but never shown as the label.
export function inspectionLabel(inspection) {
  const partNumber = inspection.part_number || `Part #${inspection.part_id}`;
  const wo = inspection.job_number ? `WO# ${inspection.job_number}` : "WO# —";
  const date = inspection.date ? inspection.date.slice(0, 10) : "—";
  return `${partNumber} — ${wo} — ${date}`;
}
