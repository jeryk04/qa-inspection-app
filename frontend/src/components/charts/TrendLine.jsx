import { useState } from "react";

const WIDTH = 640;
const HEIGHT = 180;
const PAD_LEFT = 32;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

function formatShortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Single-series trend line -- 2px stroke, hairline gridlines, hover
// crosshair + tooltip snapped to the nearest day (see the dataviz skill's
// interaction.md: "the crosshair finds the X", readers aim at a date, not
// a 2px line). Renders emptyMessage instead of a flat all-zero line when
// there's genuinely nothing to show yet.
export default function TrendLine({ data, emptyMessage, color = "var(--accent)" }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const total = data.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) {
    return <p className="chart-empty muted">{emptyMessage}</p>;
  }

  const max = Math.max(...data.map((d) => d.count));
  const niceMax = max <= 4 ? 4 : Math.ceil(max * 1.15);
  const stepX = data.length > 1 ? PLOT_W / (data.length - 1) : 0;
  const xFor = (i) => PAD_LEFT + i * stepX;
  const yFor = (count) => PAD_TOP + PLOT_H - (count / niceMax) * PLOT_H;

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(d.count)}`).join(" ");
  const gridSteps = [0, 0.5, 1];

  // A handful of x-axis labels, not one per day -- selective labeling.
  const labelIndices = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  const hovered = hoverIndex != null ? data[hoverIndex] : null;

  return (
    <div className="trend-line-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="trend-line-svg" preserveAspectRatio="none">
        {gridSteps.map((s) => {
          const y = PAD_TOP + PLOT_H - s * PLOT_H;
          return <line key={s} x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} className="chart-gridline" />;
        })}
        {gridSteps.map((s) => (
          <text key={s} x={PAD_LEFT - 8} y={PAD_TOP + PLOT_H - s * PLOT_H + 4} className="chart-axis-label" textAnchor="end">
            {Math.round(s * niceMax)}
          </text>
        ))}

        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {hoverIndex != null && (
          <line
            x1={xFor(hoverIndex)}
            x2={xFor(hoverIndex)}
            y1={PAD_TOP}
            y2={PAD_TOP + PLOT_H}
            className="chart-crosshair"
          />
        )}

        {data.map((d, i) => (
          <circle
            key={d.date}
            cx={xFor(i)}
            cy={yFor(d.count)}
            r={i === data.length - 1 || i === hoverIndex ? 4.5 : 0}
            fill={color}
            stroke="white"
            strokeWidth="2"
          />
        ))}

        {data.map((d, i) => (
          <rect
            key={d.date}
            x={xFor(i) - stepX / 2}
            y={PAD_TOP}
            width={Math.max(stepX, 1)}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex(null)}
            onFocus={() => setHoverIndex(i)}
            onBlur={() => setHoverIndex(null)}
            tabIndex={0}
          />
        ))}

        {labelIndices.map((i) => (
          <text key={i} x={xFor(i)} y={HEIGHT - 6} className="chart-axis-label" textAnchor="middle">
            {formatShortDate(data[i].date)}
          </text>
        ))}
      </svg>

      {hovered && (
        <div
          className="chart-tooltip"
          style={{ left: `${(xFor(hoverIndex) / WIDTH) * 100}%`, top: `${(yFor(hovered.count) / HEIGHT) * 100}%` }}
        >
          <strong>{hovered.count}</strong> on {formatShortDate(hovered.date)}
        </div>
      )}
    </div>
  );
}
