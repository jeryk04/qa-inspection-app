// A single ratio against a limit (see the dataviz skill's choosing-a-form:
// "a single ratio against a limit -> Meter, not a 2-slice pie"). The fill
// carries severity (ok green here, since this measures a pass rate); the
// unfilled track is a lighter step of the same ramp so state reads across
// the whole bar, not just the filled tip.
export default function Meter({ within, outOf, emptyMessage, label = "within tolerance", unit = "measurements" }) {
  const total = within + outOf;
  if (total === 0) {
    return <p className="chart-empty muted">{emptyMessage}</p>;
  }

  const pct = Math.round((within / total) * 100);

  return (
    <div className="meter">
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="meter-readout">
        <strong>{pct}%</strong> {label}
        <span className="muted">
          {" "}
          ({within.toLocaleString()} of {total.toLocaleString()} {unit})
        </span>
      </div>
    </div>
  );
}
