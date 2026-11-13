import { RANGE_PRESETS, ROLE_FILTERS, presetRange } from "../lib/performance";

// Date range (+ optional role) filter shared by the Inspector Performance
// pages. The pages keep it in the URL (?from=&to=&role=, see
// lib/performance.js's readRange) so going back from a Data Sheet, or
// sharing the link, keeps the same view.
export default function PerformanceFilters({ range, onChange, showRole = false }) {
  const activePreset = RANGE_PRESETS.find(([days]) => {
    const p = presetRange(days);
    return p.from === range.from && p.to === range.to;
  })?.[0];

  return (
    <div className="filter-form performance-filters">
      <div className="segmented" role="group" aria-label="Date range">
        {RANGE_PRESETS.map(([days, label]) => (
          <button
            key={days}
            type="button"
            className={activePreset === days ? "segmented-active" : ""}
            aria-pressed={activePreset === days}
            onClick={() => onChange({ ...range, ...presetRange(days) })}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        type="date"
        aria-label="From"
        value={range.from}
        max={range.to}
        onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })}
      />
      <span className="muted">to</span>
      <input
        type="date"
        aria-label="To"
        value={range.to}
        min={range.from}
        onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })}
      />
      {showRole && (
        <select aria-label="Who" value={range.role} onChange={(e) => onChange({ ...range, role: e.target.value })}>
          {ROLE_FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
