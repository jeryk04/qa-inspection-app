import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import PageNav from "../components/PageNav";
import PerformanceFilters from "../components/PerformanceFilters";
import { ROLE_LABELS, formatDate } from "../lib/format";
import { ROLE_FILTERS, formatMinutes, pct, readRange } from "../lib/performance";

// QA Manager's (and admin's) team view: one row per person who performed a
// Data Sheet in the range -- how many, how they turned out, and how many
// the automatic checks flagged (see backend routes/inspectorAnalytics.js
// and lib/sheetFlags.js), with a name search. Click a name for that
// person's daily chart, sheets, and each flag's details (InspectorDetail.jsx).
export default function InspectorPerformance() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = readRange(searchParams);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [nameQuery, setNameQuery] = useState("");

  useEffect(() => {
    setError(null);
    api
      .getInspectorAnalytics(range)
      .then(setData)
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, range.role]);

  const setRange = (next) => setSearchParams({ from: next.from, to: next.to, role: next.role }, { replace: true });
  const query = `?from=${range.from}&to=${range.to}`;
  const trimmedNameQuery = nameQuery.trim().toLowerCase();
  const people = data
    ? data.inspectors.filter((p) => !trimmedNameQuery || p.full_name.toLowerCase().includes(trimmedNameQuery))
    : [];

  return (
    <div className="page performance-page">
      <PageNav backTo="/" backLabel="Back to Home" items={[{ label: "Home", to: "/" }, { label: "Inspector Performance" }]} />
      <h1>Inspector Performance</h1>
      <p className="muted performance-intro">
        Data Sheets performed by each person. A sheet counts for whoever entered its readings, even if someone else
        opened it. Flags are automatic checks for likely mistakes, worth a second look, not a verdict.
      </p>

      <PerformanceFilters range={range} onChange={setRange} showRole />

      {error && <p className="error">{error}</p>}
      {!data && !error && <p>Loading...</p>}

      {data && (
        <>
          <div className="search-bar performance-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search by name..."
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
            />
          </div>

          {data.inspectors.length === 0 ? (
            <p className="muted">Nobody in this group performed a Data Sheet in this range.</p>
          ) : people.length === 0 ? (
            <p className="muted">Nobody matches "{nameQuery.trim()}".</p>
          ) : (
            <div className="table-scroll">
              <table className="performance-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th className="num">Sheets</th>
                    <th className="num">Days active</th>
                    <th className="num">Per active day</th>
                    <th className="num">Readings</th>
                    <th>Results</th>
                    <th className="num">In progress</th>
                    <th className="num">Flagged</th>
                    <th className="num">Median entry time</th>
                    <th>Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.user_id}>
                      <td>
                        <Link to={`/team-performance/${p.user_id}${query}`}>
                          <strong>{p.full_name}</strong>
                        </Link>
                        {!p.active && <span className="muted"> (inactive)</span>}
                      </td>
                      <td>
                        <div className="role-badges">
                          {[p.role, ...(p.extra_roles || [])].map((r) => (
                            <span key={r} className={`role-badge role-badge-${r}`}>
                              {ROLE_LABELS[r] ?? r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="num">{p.sheets}</td>
                      <td className="num">{p.active_days}</td>
                      <td className="num">{p.per_active_day.toFixed(1)}</td>
                      <td className="num">{p.readings.toLocaleString()}</td>
                      <td className="performance-results">
                        <span className="result-ok">{p.approved} approved</span>
                        {p.conditional > 0 && <span className="result-conditional"> · {p.conditional} cond.</span>}
                        {p.rejected > 0 && <span className="result-fail"> · {p.rejected} rejected</span>}
                      </td>
                      <td className="num">{p.in_progress}</td>
                      <td className="num">
                        {p.flagged_sheets > 0 ? (
                          <span className="flag-count">
                            {p.flagged_sheets} ({pct(p.flagged_sheets, p.sheets)})
                          </span>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                      <td className="num">{formatMinutes(p.median_minutes_to_sign)}</td>
                      <td>{formatDate(p.last_day)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted chart-footnote">
            Median entry time: from the first value typed into a sheet to its signature. Showing:{" "}
            {ROLE_FILTERS.find(([value]) => value === data.role)?.[1] ?? "QC + Operators"}.
          </p>
        </>
      )}
    </div>
  );
}
