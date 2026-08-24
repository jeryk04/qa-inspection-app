import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { inspectionLabel, resultStatus, resultLabel } from "../lib/format";
import { useConfirm } from "../hooks/useConfirm";

// Mirrors Inspections.jsx's "Data Sheet folder + history" structure, scoped
// to one operation_id instead of a part's Final drawing. See Inspections.jsx
// for the shared concept; kept as a separate component (not a parameterized
// reuse of Inspections.jsx) since the two pages are wired to different route
// params (partId only vs. partId+operationId) and Inspections.jsx was left
// untouched by design for this step.
export default function OperationDetail() {
  const { partId, operationId } = useParams();
  const navigate = useNavigate();
  const [part, setPart] = useState(null);
  const [operation, setOperation] = useState(null);
  const [inspections, setInspections] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { inspectionId, x, y }
  const [confirm, confirmDialog] = useConfirm();

  const load = () => {
    api.getPart(partId).then(setPart).catch((e) => setError(e.message));
    api
      .getOperations(partId)
      .then((ops) => setOperation(ops.find((o) => String(o.id) === operationId) ?? null))
      .catch((e) => setError(e.message));
    api
      .getInspections({ operation_id: operationId, type: "in_process" })
      .then(setInspections)
      .catch((e) => setError(e.message));
    api.getOperationDrawings(operationId).then(setDrawings).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [partId, operationId]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const handleContextMenu = (e, inspection) => {
    e.preventDefault();
    setContextMenu({ inspectionId: inspection.id, x: e.clientX, y: e.clientY });
  };

  const handleDelete = async (inspection) => {
    setContextMenu(null);
    if (!(await confirm("Are you sure you want to delete this inspection?"))) return;
    try {
      await api.deleteInspection(inspection.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const openDataSheet = async () => {
    if (drawings.length === 0) {
      setError("This operation doesn't have a Data Sheet Template set up yet. Set it up first.");
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const drawing = drawings[0]; // latest version (drawings sorted by version DESC)
      const inspection = await api.createInspection({
        part_id: Number(partId),
        drawing_id: drawing.id,
        operation_id: Number(operationId),
        type: "in_process",
      });
      navigate(`/inspections/${inspection.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="page">
      <Link to={`/parts/${partId}/operations`} className="back-link">
        ← Operations
      </Link>
      <h1>
        {operation?.name ?? "Operation"} — {part?.part_number ?? `Part #${partId}`}
      </h1>

      <button className="datasheet-file" onClick={openDataSheet} disabled={opening}>
        <svg
          className="datasheet-file-icon"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M3 7a2 2 0 0 1 2-2h3.5l1.5 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        </svg>
        <span className="datasheet-file-label">Data Sheet — {operation?.name ?? "Operation"}</span>
      </button>
      <Link to={`/parts/${partId}/template?operation_id=${operationId}`} className="secondary-link">
        Data Sheet Template
      </Link>

      {error && <p className="error">{error}</p>}

      <h2>Inspection History</h2>
      <p className="muted">Right-click an inspection to delete it.</p>
      {groupByYear(inspections).map(([year, yearInspections]) => (
        <div key={year}>
          <h3>{year}</h3>
          <ul className="card-list">
            {yearInspections.map((i) => (
              <li key={i.id} className="card" onContextMenu={(e) => handleContextMenu(e, i)}>
                <Link to={`/inspections/${i.id}`}>
                  <strong>{inspectionLabel(i)}</strong>
                  <span className="muted"> · </span>
                  <span className={`status status-${resultStatus(i)}`}>{resultLabel(resultStatus(i))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {inspections.length === 0 && <p className="muted">No inspections recorded for this operation yet.</p>}

      {contextMenu && (
        <ul className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <li
            className="context-menu-danger"
            onClick={() => handleDelete(inspections.find((i) => i.id === contextMenu.inspectionId))}
          >
            Delete
          </li>
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}

// Duplicated from Inspections.jsx (not exported there) -- see the "rough
// edges" note in this step's summary.
function groupByYear(inspections) {
  const groups = new Map();
  inspections.forEach((i) => {
    const year = i.date.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(i);
  });
  return [...groups.entries()];
}
