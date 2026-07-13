import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";

export default function Inspections() {
  const { partId } = useParams();
  const navigate = useNavigate();
  const [inspections, setInspections] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    api.getInspections({ part_id: partId }).then(setInspections).catch((e) => setError(e.message));
    api.getDrawings(partId).then(setDrawings).catch((e) => setError(e.message));
  };

  useEffect(load, [partId]);

  const createInspection = async () => {
    if (drawings.length === 0) {
      setError("This part doesn't have a Balloon Drawing set up yet. Set it up first.");
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
        ← Clients
      </Link>
      <h1>Inspections — Part #{partId}</h1>

      <div className="actions-row">
        <button onClick={createInspection} disabled={creating}>
          + New Final Inspection
        </button>
        <Link to={`/parts/${partId}/drawing`} className="secondary-link">
          Set up Balloon Drawing
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <ul className="card-list">
        {inspections.map((i) => (
          <li key={i.id} className="card">
            <Link to={`/inspections/${i.id}`}>
              <strong>{i.type}</strong>
              <span className="muted"> · {i.date} · </span>
              <span className={`status status-${i.status}`}>{i.status}</span>
            </Link>
          </li>
        ))}
        {inspections.length === 0 && <p className="muted">No inspections for this part yet.</p>}
      </ul>
    </div>
  );
}
