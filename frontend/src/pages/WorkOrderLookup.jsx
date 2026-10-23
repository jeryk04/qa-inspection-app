import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import PageNav from "../components/PageNav";
import { resultStatus, resultLabel, TYPE_LABELS, formatDate } from "../lib/format";

// Fixed display order regardless of which types the search actually found --
// so a missing type still renders as its own "Not recorded" row instead of
// silently disappearing from the checklist.
const TYPE_ORDER = ["incoming", "setup", "in_process", "final"];

// Groups a flat inspections list (as returned by GET /api/inspections) by
// part, then by type within each part -- a part can have more than one
// inspection of the same type under one WO# (Set-up/In-Process are scoped
// per operation, see CLAUDE.md, so e.g. "Bending" and "Groove" each get
// their own Set-up inspection), so every type bucket is a list, not a
// single result.
function groupByPart(inspections) {
  const parts = new Map();
  for (const insp of inspections) {
    if (!parts.has(insp.part_id)) {
      parts.set(insp.part_id, {
        part_id: insp.part_id,
        part_number: insp.part_number,
        client_name: insp.client_name,
        byType: {},
      });
    }
    const group = parts.get(insp.part_id);
    (group.byType[insp.type] ||= []).push(insp);
  }
  return [...parts.values()].sort((a, b) => a.part_number.localeCompare(b.part_number));
}

export default function WorkOrderLookup() {
  const [jobNumber, setJobNumber] = useState("");
  const [groups, setGroups] = useState(null); // null = no search run yet
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!jobNumber.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const results = await api.getInspections({ job_number: jobNumber.trim() });
      setGroups(groupByPart(results));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <PageNav backTo="/" backLabel="Back to Home" items={[{ label: "Home", to: "/" }, { label: "WO# Lookup" }]} />
      <h1>WO# Lookup</h1>
      <p className="muted">
        Search a Work Order / Job number to see every inspection recorded under it, grouped by part
        -- so you can check at a glance whether Set-up, In-Process, Incoming, or Final is still missing.
      </p>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          placeholder="Work Order # / Job #"
          value={jobNumber}
          onChange={(e) => setJobNumber(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={loading || !jobNumber.trim()}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {groups && groups.length === 0 && <p className="muted">No inspections found for that WO#.</p>}

      {groups && groups.length > 1 && (
        <p className="warning-note">
          This WO# shows up under {groups.length} different parts -- double check that's expected.
        </p>
      )}

      {groups &&
        groups.map((group) => (
          <div key={group.part_id} className="card wo-part-group">
            <h3>
              {group.client_name} — {group.part_number}
            </h3>
            <ul className="wo-type-checklist">
              {TYPE_ORDER.map((type) => {
                const items = group.byType[type] || [];
                return (
                  <li key={type} className="wo-type-row">
                    <span className="wo-type-label">{TYPE_LABELS[type]}</span>
                    {items.length === 0 ? (
                      <span className="status status-inactive">Not recorded</span>
                    ) : (
                      <ul className="wo-type-items">
                        {items.map((i) => (
                          <li key={i.id}>
                            <span className={`status status-${resultStatus(i)}`}>
                              {resultLabel(resultStatus(i))}
                            </span>{" "}
                            <span className="muted">
                              {formatDate(i.date)} · {i.inspector || "—"}
                            </span>{" "}
                            <Link to={`/inspections/${i.id}`}>Open</Link>
                            {" · "}
                            <Link to={`/inspections/${i.id}/sheet`}>Sheet</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </div>
  );
}
