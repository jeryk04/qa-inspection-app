import { isSpecless, parsePassFail } from "../lib/passfail";
import RunChart from "./charts/RunChart";
import Meter from "./charts/Meter";

// One card per Find# on a drawing, each showing its real measurement
// history -- a numeric run-chart against the point's Max/Mean/Min spec for
// a normal point, or an OK/Not-OK pass-rate Meter for a specless
// (Fixture/Visual-style check) point, since a numeric chart doesn't apply
// there (no spec to plot against, and the stored value is "OK"/"NOT OK ..."
// text, not a number) -- same distinction `summarizeCheckPoint` makes
// elsewhere (see lib/passfail.js). `analytics` is the { points: { [pointId]:
// { totalRows, filledRows, readings } } } shape from GET /drawings/:id/analytics.
export default function PointMeasurementHistory({ points, analytics }) {
  if (!points || points.length === 0) {
    return <p className="muted">This part doesn't have a Data Sheet Template set up yet.</p>;
  }

  return (
    <>
      {points.map((p) => {
        const pointAnalytics = analytics.points[p.id] ?? { totalRows: 0, filledRows: 0, readings: [] };
        const emptyMessage =
          pointAnalytics.totalRows > 0
            ? `0 of ${pointAnalytics.totalRows} sample rows filled in yet.`
            : "No measurements recorded yet.";

        if (isSpecless(p)) {
          let ok = 0;
          let notOk = 0;
          pointAnalytics.readings.forEach((r) => {
            const { state } = parsePassFail(r.value);
            if (state === "ok") ok += 1;
            else if (state === "not_ok") notOk += 1;
          });
          return (
            <div key={p.id} className="form-card">
              <h3>Find# {p.balloon_number}</h3>
              <Meter within={ok} outOf={notOk} label="OK" unit="samples" emptyMessage={emptyMessage} />
            </div>
          );
        }

        return (
          <div key={p.id} className="form-card">
            <h3>Find# {p.balloon_number}</h3>
            <RunChart point={p} analytics={pointAnalytics} />
          </div>
        );
      })}
    </>
  );
}
