import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";

export default function Inspections() {
  const { partId } = useParams();
  const navigate = useNavigate();
  const [part, setPart] = useState(null);
  const [inspections, setInspections] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    api.getPart(partId).then(setPart).catch((e) => setError(e.message));
    api.getInspections({ part_id: partId, type: "final" }).then(setInspections).catch((e) => setError(e.message));
    api.getDrawings(partId).then(setDrawings).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [partId]);

  const createInspection = async () => {
    if (drawings.length === 0) {
      setError("This part doesn't have a Drawing set up yet. Set it up first.");
      return;
    }
    setCreating(true);
    try {
      const drawing = drawings[0]; // uses the most recent one (phase 1: a single active version)
      const inspection = await api.createInspection({
        part_id: Number(partId),
        drawing_id: drawing.id,
        type: "final",
      });
      navigate(`/inspections/${inspection.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <Link to={`/clients`} className="back-link">
        ← Customers
      </Link>
      <h1>Data Sheets — {part?.part_number ?? `Part #${partId}`}</h1>

      <div className="actions-row">
        <button onClick={createInspection} disabled={creating}>
          + New Data Sheet
        </button>
        <Link to={`/parts/${partId}/drawing`} className="secondary-link">
          Set up Drawing
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      {groupByYear(inspections).map(([year, yearInspections]) => (
        <div key={year}>
          <h2>{year}</h2>
          <ul className="card-list">
            {yearInspections.map((i) => (
              <li key={i.id} className="card">
                <Link to={`/inspections/${i.id}`}>
                  <strong>Data Sheet</strong>
                  <span className="muted"> · {i.date} · </span>
                  <span className={`status status-${i.status}`}>{i.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {inspections.length === 0 && <p className="muted">No Data Sheets for this part yet.</p>}
    </div>
  );
}

// Groups already-date-sorted inspections into [year, items[]] pairs, newest
// year first — mirrors the year-subfolder structure of the old file archive.
function groupByYear(inspections) {
  const groups = new Map();
  inspections.forEach((i) => {
    const year = i.date.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(i);
  });
  return [...groups.entries()];
}
