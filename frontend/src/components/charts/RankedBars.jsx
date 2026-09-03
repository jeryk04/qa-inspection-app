import { useState } from "react";

// Horizontal ranked bars -- single flat hue (these are nominal categories,
// so per the dataviz skill a per-bar gradient would be a "value-ramp on
// nominal categories" anti-pattern; length alone carries the magnitude).
// Each bar is its own hover/focus hit target with a tooltip, per the
// skill's "on bars and cells, the mark is the hit target" rule. Renders
// emptyMessage instead of an all-zero chart when items is empty.
//
// cumulative=true turns this into a Pareto view: each item must also carry
// a `cumulativePct` (0-100, running total across ALL items server-side, not
// just the ones shown here). Rendered as a per-row % label plus a single
// divider inserted right after the row where the cumulative total first
// crosses 80% -- deliberately NOT a count-bars-plus-cumulative-%-line dual-
// axis chart (the dataviz skill's #1 anti-pattern: two y-scales invent a
// false alignment); indexing to one axis via a label + threshold divider
// gets the same "which few items are the vital few" read without it.
export default function RankedBars({ items, emptyMessage, color = "var(--fail)", valueLabel = "", cumulative = false }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (items.length === 0) {
    return <p className="chart-empty muted">{emptyMessage}</p>;
  }

  const max = Math.max(...items.map((it) => it.count));
  const dividerAfterIndex = cumulative ? items.findIndex((it) => it.cumulativePct >= 80) : -1;

  return (
    <ul className="ranked-bars">
      {items.map((item, i) => {
        const pct = max > 0 ? (item.count / max) * 100 : 0;
        return (
          <li key={`${item.label}-${i}`}>
            <div
              className="ranked-bar-row"
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex(null)}
              tabIndex={0}
            >
              <span className="ranked-bar-label">{item.label}</span>
              <span className="ranked-bar-track">
                <span className="ranked-bar-fill" style={{ width: `${pct}%`, background: color }} />
              </span>
              <span className="ranked-bar-value">
                {item.count}
                {cumulative && <span className="ranked-bar-cumulative">{item.cumulativePct}% cum.</span>}
              </span>
              {hoverIndex === i && (
                <div className="chart-tooltip chart-tooltip-static">
                  <strong>{item.count}</strong> {valueLabel} — {item.sublabel}
                </div>
              )}
            </div>
            {i === dividerAfterIndex && (
              <div className="ranked-bar-pareto-divider">
                <span>80% threshold — the rest is the long tail</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
