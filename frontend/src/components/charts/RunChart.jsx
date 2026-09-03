import { useState } from "react";

const WIDTH = 640;
const HEIGHT = 160;
const PAD_LEFT = 44;
const PAD_RIGHT = 30; // room for the UCL/LCL control-limit labels on the right edge
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

function formatShortDate(value) {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const STATUS_COLOR = { 1: "var(--ok)", 0: "var(--fail)" };
const NEUTRAL_COLOR = "var(--border-strong)";

// Shared floor for every statistic below that estimates the *process*
// (not one reading): under CPK_MIN_N points, mean/stdDev are too noisy to
// say anything real, so both Cpk and the control limits stay hidden
// rather than show a number that would just be sampling noise.
const CPK_MIN_N = 5;
const CPK_CONFIDENT_N = 20;
const CPK_THRESHOLD = 1.33;

function computeStats(values) {
  const n = values.length;
  if (n < CPK_MIN_N) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  if (!(stdDev > 0)) return null; // no variation to estimate the process from (or a single distinct value)
  return { mean, stdDev, n };
}

// Process Capability (Cpk) -- a leading indicator, distinct from the
// per-sample pass/fail dots above: it asks "given how this process is
// actually centered and how much it varies, how much margin is there
// before it drifts into failing?", not "did any one reading fail." The
// industry-standard read is Cpk >= 1.33 = capable. Below the confidence
// floor (CPK_MIN_N) the estimate is too noisy to trust and isn't shown at
// all; between the floor and CPK_CONFIDENT_N it's shown but not color-
// flagged, since calling a process "not capable" off a handful of samples
// would be a false alarm, not a real signal -- the flag only fires once
// there's enough data to actually mean something.
function computeCpk(stats, maxSpec, minSpec) {
  if (!stats) return null;
  const hasMax = maxSpec != null;
  const hasMin = minSpec != null;
  if (!hasMax && !hasMin) return null;

  const cpu = hasMax ? (maxSpec - stats.mean) / (3 * stats.stdDev) : Infinity;
  const cpl = hasMin ? (stats.mean - minSpec) / (3 * stats.stdDev) : Infinity;
  return { cpk: Math.min(cpu, cpl), n: stats.n };
}

// Statistical control limits (mean +/- 3 sigma of every individual
// reading) -- the other half of an SPC chart, distinct from the spec
// lines: spec is what the *customer* requires, control limits are what
// *this process* actually does. A process can run entirely inside spec
// while still drifting outside its own control limits -- an early warning
// before a real out-of-spec reading happens. Computed from individual
// readings rather than per-batch subgroup averages (the classic Xbar-R
// A2-constant formula) because real batch size here varies run to run
// (single-sample legacy data alongside 5+-sample batches going forward),
// so there's no single constant subgroup size to key a lookup table on.
function computeControlLimits(stats) {
  if (!stats) return null;
  return { ucl: stats.mean + 3 * stats.stdDev, lcl: stats.mean - 3 * stats.stdDev };
}

// One Find#'s measured values against its own spec band, grouped by
// production batch (one inspection = one Work Order's Data Sheet) -- a
// control-chart style scatter (see the dataviz skill: this is the
// standard engineering form for "actual values vs. a limit over time"),
// subgrouped the way a real Xbar-R chart is: one x-slot per batch, not
// per individual reading, since a batch is almost always 5+ samples and
// they need to read as "these came from the same WO#," not as unrelated
// points on a flat timeline. Dots are deliberately NOT connected by a
// line -- these are discrete sample events, not a continuous series, and
// a connecting line would imply interpolation that isn't real. Each dot
// is colored by status (within/out of tolerance/not yet evaluated) --
// the metric IS pass/fail, so it wears this app's existing status
// tokens, not a generic categorical hue.
export default function RunChart({ point, analytics }) {
  const { totalRows, filledRows, batches } = analytics;
  const [hovered, setHovered] = useState(null); // { batchIndex, sampleIndex }

  if (filledRows === 0) {
    return (
      <p className="chart-empty muted">
        {totalRows > 0
          ? `0 of ${totalRows} sample rows filled in yet.`
          : "No measurements recorded yet."}
      </p>
    );
  }

  const specValues = [point.max_spec, point.min_spec, point.mean_value].filter((v) => v != null);
  const allReadingValues = batches.flatMap((b) => b.samples.map((s) => s.value));
  const stats = computeStats(allReadingValues);
  const capability = computeCpk(stats, point.max_spec, point.min_spec);
  const controlLimits = computeControlLimits(stats);
  const controlValues = controlLimits ? [controlLimits.ucl, controlLimits.lcl] : [];
  const allValues = [...specValues, ...allReadingValues, ...controlValues];
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const span = rawMax - rawMin || Math.abs(rawMax) * 0.1 || 1;
  const domainMin = rawMin - span * 0.15;
  const domainMax = rawMax + span * 0.15;
  const domainSpan = domainMax - domainMin || 1;

  const yFor = (v) => PAD_TOP + PLOT_H - ((v - domainMin) / domainSpan) * PLOT_H;
  const stepX = batches.length > 1 ? PLOT_W / (batches.length - 1) : 0;
  const xFor = (i) => (batches.length === 1 ? PAD_LEFT + PLOT_W / 2 : PAD_LEFT + i * stepX);
  const batchMean = (b) => b.samples.reduce((sum, s) => sum + s.value, 0) / b.samples.length;

  const decimals = point.decimal_places ?? 3;
  const fmt = (v) => Number(v).toFixed(decimals);

  const refLines = [
    { key: "max", value: point.max_spec, label: "Max" },
    { key: "mean", value: point.mean_value, label: "Mean" },
    { key: "min", value: point.min_spec, label: "Min" },
  ].filter((r) => r.value != null);

  // Rendered on the opposite side from the spec labels (left) so the two
  // kinds of limit never collide even when a control limit lands close to
  // a spec value.
  const controlRefLines = controlLimits
    ? [
        { key: "ucl", value: controlLimits.ucl, label: "UCL" },
        { key: "lcl", value: controlLimits.lcl, label: "LCL" },
      ]
    : [];

  const hoveredSample = hovered ? batches[hovered.batchIndex].samples[hovered.sampleIndex] : null;
  const hoveredBatch = hovered ? batches[hovered.batchIndex] : null;

  return (
    <div className="trend-line-wrap">
      {capability && (
        <div
          className={`cpk-badge${
            capability.n >= CPK_CONFIDENT_N ? (capability.cpk >= CPK_THRESHOLD ? " cpk-badge-ok" : " cpk-badge-fail") : ""
          }`}
          title={
            capability.n >= CPK_CONFIDENT_N
              ? "Process Capability — industry standard is 1.33+"
              : `Preliminary — needs ${CPK_CONFIDENT_N}+ readings (has ${capability.n}) for a confident capability read`
          }
        >
          Cpk {capability.cpk.toFixed(2)}
          <span className="cpk-badge-n">n={capability.n}</span>
        </div>
      )}

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="trend-line-svg" preserveAspectRatio="none">
        {controlRefLines.map((r) => (
          <g key={r.key}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(r.value)}
              y2={yFor(r.value)}
              className="chart-control-line"
            />
            <text x={WIDTH - PAD_RIGHT + 4} y={yFor(r.value) + 4} className="chart-axis-label chart-control-label">
              {r.label}
            </text>
          </g>
        ))}

        {refLines.map((r) => (
          <g key={r.key}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yFor(r.value)} y2={yFor(r.value)} className="chart-refline" />
            <text x={PAD_LEFT - 8} y={yFor(r.value) + 4} className="chart-axis-label" textAnchor="end">
              {fmt(r.value)}
            </text>
          </g>
        ))}

        {hovered != null && (
          <line
            x1={xFor(hovered.batchIndex)}
            x2={xFor(hovered.batchIndex)}
            y1={PAD_TOP}
            y2={PAD_TOP + PLOT_H}
            className="chart-crosshair"
          />
        )}

        {batches.map((b, bi) => (
          <line
            key={`mean-${b.inspection_id}`}
            x1={xFor(bi) - 7}
            x2={xFor(bi) + 7}
            y1={yFor(batchMean(b))}
            y2={yFor(batchMean(b))}
            className="chart-batch-mean"
          />
        ))}

        {batches.map((b, bi) =>
          b.samples.map((s, si) => (
            <circle
              key={`${b.inspection_id}-${si}`}
              cx={xFor(bi)}
              cy={yFor(s.value)}
              r={hovered && hovered.batchIndex === bi && hovered.sampleIndex === si ? 6 : 4.5}
              fill={STATUS_COLOR[s.within_tolerance] ?? NEUTRAL_COLOR}
              stroke="white"
              strokeWidth="2"
            />
          ))
        )}

        {batches.map((b, bi) =>
          b.samples.map((s, si) => (
            <rect
              key={`hit-${b.inspection_id}-${si}`}
              x={xFor(bi) - Math.max(stepX, 24) / 2}
              y={yFor(s.value) - 8}
              width={Math.max(stepX, 24)}
              height={16}
              fill="transparent"
              onMouseEnter={() => setHovered({ batchIndex: bi, sampleIndex: si })}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered({ batchIndex: bi, sampleIndex: si })}
              onBlur={() => setHovered(null)}
              tabIndex={0}
            />
          ))
        )}

        {batches.length > 1 && (
          <>
            <text x={xFor(0)} y={HEIGHT - 6} className="chart-axis-label" textAnchor="middle">
              {batches[0].job_number}
            </text>
            <text x={xFor(batches.length - 1)} y={HEIGHT - 6} className="chart-axis-label" textAnchor="middle">
              {batches[batches.length - 1].job_number}
            </text>
          </>
        )}
      </svg>

      {hoveredSample && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(xFor(hovered.batchIndex) / WIDTH) * 100}%`,
            top: `${(yFor(hoveredSample.value) / HEIGHT) * 100}%`,
          }}
        >
          <strong>{fmt(hoveredSample.value)}</strong> — {hoveredBatch.job_number}, sample {hoveredSample.sample_number}
          <br />
          {formatShortDate(hoveredBatch.date)}
        </div>
      )}

      {filledRows < totalRows && (
        <p className="chart-footnote muted">
          {filledRows} of {totalRows} sample rows filled in so far.
        </p>
      )}
    </div>
  );
}
