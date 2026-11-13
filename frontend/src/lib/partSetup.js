// Inspection types as Browse Customers' setup status shows them (see
// backend/src/lib/partSetup.js). Final and Incoming share the part's default
// Data Sheet Template; the rest have one template per operation. `type` is
// the ?type= the existing pages take; `scope` forces OperationsList.jsx onto
// a specific list (the Operator's In-Process list isn't otherwise reachable
// from a QC/admin account).
export const SETUP_TYPES = [
  { key: "final", label: "Final & Incoming", short: "Final" },
  { key: "setup", label: "Set-up", short: "Set-up", type: "setup" },
  { key: "in_process_qc", label: "In-Process (QC)", short: "In-Process QC", type: "in_process" },
  {
    key: "in_process_operator",
    label: "In-Process (Operator)",
    short: "In-Process Op",
    type: "in_process",
    scope: "in_process_operator",
  },
  { key: "samples", label: "Samples", short: "Samples", type: "samples" },
];

// Browse Suppliers: a supplier's part is only ever inspected on arrival, so
// just its Incoming template (the part's default one, shared with Final).
export const SUPPLIER_SETUP_TYPES = [{ key: "final", label: "Incoming Inspection", short: "Incoming" }];

// "ready" (template set up -- for an operation type, on every operation),
// "partial" (some operations set up), or "none".
export function setupState(status, key) {
  if (key === "final") return status.final.template ? "ready" : "none";
  const ops = status[key] || [];
  const ready = ops.filter((o) => o.template).length;
  if (ops.length === 0 || ready === 0) return "none";
  return ready === ops.length ? "ready" : "partial";
}

export function operationsListHref(partId, t) {
  return `/parts/${partId}/operations?type=${t.type}${t.scope ? `&scope=${t.scope}` : ""}`;
}
