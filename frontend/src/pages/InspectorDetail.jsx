import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import PageNav from "../components/PageNav";
import PerformanceFilters from "../components/PerformanceFilters";
import DailyBars from "../components/charts/DailyBars";
import { ROLE_LABELS, formatDate, orderRefLabel, resultLabel, resultStatus, typeLabel } from "../lib/format";
import { formatMinutes, pct, readRange } from "../lib/performance";

// Same wording as backend/src/lib/sheetFlags.js's labels, for the
// per-person breakdown (the summary only carries flag codes).
const FLAG_LABELS = {
  likely_typo: "Possible typo",
  approved_with_failures: "Approved with failures",
  rejected_count_mismatch: "Total Rejected doesn't match",
  blank_cells: "Empty cells",
  reopened: "Reopened after signing",
  stale: "Not finished",
};

// One QC Inspector's / Operator's Data Sheets in the range: per-day volume,
// results, and every sheet with its automatic flags spelled out, each
// linking straight to the sheet so the QA Manager can check it.
export default function InspectorDetail() {
  const { userId } = useParams();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = readRange(searchParams);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    setError(null);
    api
      .getInspectorDetail(userId, { from: range.from, to: range.to })
      .then(setData)
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, range.from, range.to]);

  const setRange = (next) => {
    const params = { from: next.from, to: next.to };
    if (searchParams.get("role")) params.role = searchParams.get("role");
    setSearchParams(params, { replace: true });
  };
  const overviewHref = `/team-performance?${searchParams.toString()}`;
  // Opening a sheet comes back here, not to the sheet's own parent page.
  const returnTo = { to: `${location.pathname}${location.search}`, label: `Back to ${data?.user.full_name ?? "inspector"}` };

  const s = data?.summary;
  const sheets = data ? (onlyFlagged ? data.sheets.filter((sh) => sh.flagged) : data.sheets) : [];

  return (
    <div className="page performance-page">
      <PageNav
        backTo={overviewHref}
        backLabel="Back to Inspector Performance"
        items={[
          { label: "Home", to: "/" },
          { label: "Inspector Performance", to: overviewHref },
          { label: data?.user.full_name ?? "…" },
        ]}
      />

      {error && <p className="error">{error}</p>}
      {!data && !error && <p>Loading...</p>}

      {data && (
        <>
          <div className="performance-person-header">
            <h1>{data.user.full_name}</h1>
            {[data.user.role, ...(data.user.extra_roles || [])].map((r) => (
              <span key={r} className={`role-badge role-badge-${r}`}>
                {ROLE_LABELS[r] ?? r}
              </span>
            ))}
            {!data.user.active && <span className="muted">Inactive</span>}
          </div>

          <PerformanceFilters range={range} onChange={setRange} />

          <div className="stats-strip">
            <div className="stat-card">
              <span className="stat-card-value">{s.sheets}</span>
              <span className="stat-card-label">
                Data Sheets on {s.active_days} day{s.active_days === 1 ? "" : "s"}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-card-value">{s.per_active_day.toFixed(1)}</span>
              <span className="stat-card-label">Sheets per active day</span>
            </div>
            <div className="stat-card">
              <span className="stat-card-value">{s.readings.toLocaleString()}</span>
              <span className="stat-card-label">Readings entered</span>
            </div>
            <div className={`stat-card${s.flagged_sheets > 0 ? " stat-card-warn" : " stat-card-ok"}`}>
              <span className="stat-card-value">{s.flagged_sheets}</span>
              <span className="stat-card-label">
                Flagged sheets ({pct(s.flagged_sheets, s.sheets)}) · {s.error_sheets} with likely errors
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-card-value">{formatMinutes(s.median_minutes_to_sign)}</span>
              <span className="stat-card-label">Median entry time</span>
            </div>
          </div>

          <section className="card performance-chart-card">
            <h2>Sheets per day</h2>
            <DailyBars data={data.daily} emptyMessage="No Data Sheets performed in this range." />
          </section>

          {Object.keys(s.flag_counts).length > 0 && (
            <section className="performance-flag-summary">
              <h2>What got flagged</h2>
              <ul>
                {Object.entries(s.flag_counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, n]) => (
                    <li key={code}>
                      <strong>{n}</strong> {FLAG_LABELS[code] ?? code}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <div className="performance-sheets-header">
            <h2>Data Sheets</h2>
            <label className="hundred-percent-toggle">
              <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
              Only flagged ({s.flagged_sheets})
            </label>
          </div>

          {sheets.length === 0 ? (
            <p className="muted">{onlyFlagged ? "No flagged sheets in this range." : "No Data Sheets in this range."}</p>
          ) : (
            <div className="table-scroll">
              <table className="performance-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Part</th>
                    <th>WO# / PO#</th>
                    <th>Type</th>
                    <th className="num">Readings</th>
                    <th>Result</th>
                    <th>Flags</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map((sh) => (
                    <tr key={sh.id} className={sh.flagged ? "performance-row-flagged" : undefined}>
                      <td>{formatDate(sh.date)}</td>
                      <td>{sh.client_name}</td>
                      <td>{sh.part_number}</td>
                      <td>{orderRefLabel(sh) ?? "—"}</td>
                      <td>
                        {typeLabel(sh.type)}
                        {sh.operation_name && <div className="muted">{sh.operation_name}</div>}
                      </td>
                      <td className="num">{sh.readings}</td>
                      <td>
                        <span className={`status status-${resultStatus(sh)}`}>{resultLabel(resultStatus(sh))}</span>
                      </td>
                      <td className="performance-flags">
                        {sh.flags.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          sh.flags.map((f, i) => (
                            <div key={i} className={`sheet-flag sheet-flag-${f.severity}`}>
                              <strong>{f.label}</strong>
                              <span>{f.detail}</span>
                            </div>
                          ))
                        )}
                      </td>
                      <td className="performance-links">
                        <Link to={`/inspections/${sh.id}/sheet`} state={{ returnTo }}>
                          View sheet
                        </Link>
                        <Link to={`/inspections/${sh.id}`} state={{ returnTo }}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
