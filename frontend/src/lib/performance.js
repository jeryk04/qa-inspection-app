// Helpers for the Inspector Performance pages (InspectorPerformance.jsx,
// InspectorDetail.jsx, components/PerformanceFilters.jsx).

const DAY_MS = 86_400_000;

export const RANGE_PRESETS = [
  [7, "Last 7 days"],
  [30, "Last 30 days"],
  [90, "Last 90 days"],
];

// Same keys as the backend's ROLE_SCOPES (routes/inspectorAnalytics.js).
export const ROLE_FILTERS = [
  ["all", "QC + Operators"],
  ["qc", "QC Inspectors"],
  ["operator", "Operators"],
  ["supervisor", "Supervisors"],
  ["qa_manager", "QA Managers"],
  ["engineer", "Quality Analytics"],
  ["admin", "Admins"],
  ["everyone", "Everyone (all roles)"],
];

// Local YYYY-MM-DD (inspection dates are local days).
export function localDay(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

export function presetRange(days) {
  return { from: localDay(new Date(Date.now() - (days - 1) * DAY_MS)), to: localDay() };
}

// Reads from/to/role off the URL, defaulting to the last 30 days.
export function readRange(searchParams) {
  const fallback = presetRange(30);
  return {
    from: searchParams.get("from") || fallback.from,
    to: searchParams.get("to") || fallback.to,
    role: searchParams.get("role") || "all",
  };
}

export function formatMinutes(m) {
  if (m == null) return "—";
  if (m < 1) return "< 1 min";
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
}

export function pct(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}
