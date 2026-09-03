// A point with a MEAN but no Max/Min is still a real numeric measurement --
// mean_value there is a reference/nominal value to measure against, not a
// pass/fail check, so it keeps the regular numeric cell (nothing to flag
// out-of-tolerance against, same as computeWithinTolerance in
// backend/src/routes/inspections.js, but still a number worth recording).
// Only a point with NO spec of any kind -- no max, no min, no mean, e.g. a
// Fixture or Visual check -- has nothing numeric to compare against at all,
// so it's captured as an OK / Not OK check instead of a measured value.
export function isSpecless(point) {
  return point.max_spec == null && point.min_spec == null && point.mean_value == null;
}

const NOT_OK_PREFIX = "NOT OK";

// Reads the cell's stored free-text value back into { state, reason }.
// state is "ok" | "not_ok" | null (null covers both an empty cell and any
// pre-existing free text that predates this OK/Not-OK convention -- neither
// toggle button reads as active for those, but the raw text is left alone
// until the inspector taps one).
export function parsePassFail(raw) {
  const trimmed = (raw ?? "").toString().trim();
  const upper = trimmed.toUpperCase();
  if (upper === "OK") return { state: "ok", reason: "" };
  if (upper.startsWith(NOT_OK_PREFIX)) {
    return { state: "not_ok", reason: trimmed.slice(NOT_OK_PREFIX.length).replace(/^[\s—-]+/, "") };
  }
  return { state: null, reason: "" };
}

// The inverse of parsePassFail -- what actually gets saved as the cell's
// measured_value.
export function formatPassFail(state, reason) {
  if (state === "ok") return "OK";
  if (state === "not_ok") return reason.trim() ? `${NOT_OK_PREFIX} — ${reason.trim()}` : NOT_OK_PREFIX;
  return "";
}

// The "qty inspected / qty rejected / reasons" summary for one specless
// (check) point on a report -- prefers an explicit inspection_point_summaries
// row (hundred_percent_inspection) if one was saved; otherwise derives the
// same shape from the point's individual measurements rows, so a large sheet
// filled via "Fill + Mark OK" (real per-sample rows, never switched to the
// 100%-inspection summary mode) still reports the same way as one that was.
export function summarizeCheckPoint(point, inspection) {
  const explicit = (inspection.pointSummaries || []).find((s) => s.balloon_point_id === point.id);
  if (explicit) {
    return {
      qtyInspected: explicit.qty_inspected,
      qtyRejected: explicit.qty_rejected,
      rejectNotes: explicit.reject_notes || "",
    };
  }

  let qtyInspected = 0;
  let qtyRejected = 0;
  const reasons = [];
  (inspection.measurements || [])
    .filter((m) => m.balloon_point_id === point.id)
    .forEach((m) => {
      if (m.measured_value == null || m.measured_value === "") return;
      qtyInspected += 1;
      const { state, reason } = parsePassFail(m.measured_value);
      if (state === "not_ok") {
        qtyRejected += 1;
        if (reason) reasons.push(reason);
      }
    });
  return { qtyInspected, qtyRejected, rejectNotes: reasons.join("; ") };
}
