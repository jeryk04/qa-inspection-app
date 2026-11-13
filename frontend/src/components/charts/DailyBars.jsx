import { useState } from "react";

function formatShortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatLongDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

// Data Sheets per day, each day's bar split into sheets with no flags
// (bottom) and flagged sheets (stacked on top, warning amber) -- two series,
// so a legend is always shown and the tooltip spells both counts out. Per
// the dataviz skill: bars anchored to the baseline with a 4px rounded top,
// a 2px surface gap between stacked segments and between bars, hairline
// gridlines, a few selective x labels, and the whole day column as the
// hover target (not just the painted bar). Colors are validated chart
// tokens (--chart-series-clean / --chart-series-flagged in App.css).
export default function DailyBars({ data, emptyMessage }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const total = data.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) {
    return <p className="chart-empty muted">{emptyMessage}</p>;
  }

  const max = Math.max(...data.map((d) => d.count));
  const niceMax = max <= 4 ? 4 : Math.ceil(max * 1.15);
  const gridSteps = [0, 0.5, 1];
  const labelIndices = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
  const hovered = hoverIndex != null ? data[hoverIndex] : null;

  return (
    <div className="daily-bars">
      <div className="daily-bars-legend">
        <span>
          <i className="daily-bars-swatch daily-bars-swatch-clean" /> No flags
        </span>
        <span>
          <i className="daily-bars-swatch daily-bars-swatch-flagged" /> Flagged
        </span>
      </div>

      <div className="daily-bars-frame">
        <div className="daily-bars-yaxis">
          {gridSteps
            .slice()
            .reverse()
            .map((s) => (
              <span key={s}>{Math.round(s * niceMax)}</span>
            ))}
        </div>

        <div className="daily-bars-plot" onMouseLeave={() => setHoverIndex(null)}>
          {gridSteps.map((s) => (
            <div key={s} className="daily-bars-gridline" style={{ bottom: `${s * 100}%` }} />
          ))}

          <div className="daily-bars-columns">
            {data.map((d, i) => {
              const clean = d.count - d.flagged;
              return (
                <div
                  key={d.date}
                  className={`daily-bars-col${hoverIndex === i ? " daily-bars-col-hover" : ""}`}
                  onMouseEnter={() => setHoverIndex(i)}
                >
                  {clean > 0 && (
                    <div
                      className={`daily-bars-seg daily-bars-seg-clean${d.flagged === 0 ? " daily-bars-seg-top" : ""}`}
                      style={{ height: `${(clean / niceMax) * 100}%` }}
                    />
                  )}
                  {d.flagged > 0 && (
                    <div
                      className="daily-bars-seg daily-bars-seg-flagged daily-bars-seg-top"
                      style={{ height: `${(d.flagged / niceMax) * 100}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {hovered && (
            <div
              className="chart-tooltip daily-bars-tooltip"
              style={{ left: `${((hoverIndex + 0.5) / data.length) * 100}%` }}
            >
              <strong>{formatLongDate(hovered.date)}</strong>
              <br />
              {hovered.count} sheet{hovered.count === 1 ? "" : "s"}
              {hovered.count > 0 && ` · ${hovered.flagged} flagged`}
            </div>
          )}
        </div>
      </div>

      <div className="daily-bars-xaxis">
        {labelIndices.map((i) => (
          <span key={i} style={{ left: `${((i + 0.5) / data.length) * 100}%` }}>
            {formatShortDate(data[i].date)}
          </span>
        ))}
      </div>
    </div>
  );
}
