import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { inspectionLabel, resultStatus, resultLabel } from "../lib/format";
import { useConfirm } from "../hooks/useConfirm";
import PageNav from "../components/PageNav";
import TemplateEditLink from "../components/TemplateEditLink";

// This deletes an already-saved inspection -- matches backend/src/routes/
// inspections.js's requireRole("admin", "supervisor") on DELETE /:id and
// OperationDetail.jsx's own guard for the same action scoped to an
// operation. Deliberately narrower than QC's usual access: QC can
// create/edit/sign a Data Sheet but not erase one.
const CAN_DELETE_ROLES = ["admin", "supervisor"];

// The "Data Sheet" folder at the top is the entry point an inspector opens
// every time an inspection is needed: it resumes the currently open (in
// progress) Data Sheet, or starts a fresh one if the last one was signed and
// locked. Every past Data Sheet (open or signed) is listed below it by date.
export default function Inspections() {
  const { partId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canDelete = CAN_DELETE_ROLES.includes(user?.role);
  const [searchParams] = useSearchParams();
  // Defaults to "final" -- the original, still-only-supported value for the
  // normal QC path (see Clients.jsx for where a non-default type comes from).
  const type = searchParams.get("type") || "final";
  const [part, setPart] = useState(null);
  const [clientName, setClientName] = useState(null);
  const [inspections, setInspections] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { inspectionId, x, y }
  const [confirm, confirmDialog] = useConfirm();

  const load = () => {
    api.getPart(partId).then(setPart).catch((e) => setError(e.message));
    api.getInspections({ part_id: partId, type }).then(setInspections).catch((e) => setError(e.message));
    api.getDrawings(partId).then(setDrawings).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [partId, type]);

  // For the breadcrumb trail only -- getPart doesn't include the client's name.
  useEffect(() => {
    if (!part?.client_id) return;
    api.getClient(part.client_id).then((c) => setClientName(c.name)).catch(() => {});
  }, [part?.client_id]);

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
      setError("This part doesn't have a Data Sheet Template set up yet. Set it up first.");
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const drawing = drawings[0]; // uses the most recent one (phase 1: a single active version)
      const inspection = await api.createInspection({
        part_id: Number(partId),
        drawing_id: drawing.id,
        type,
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
      <PageNav
        backTo={part ? `/clients/${part.client_id}/parts${type !== "final" ? `?type=${type}` : ""}` : "/clients"}
        backLabel="Back to Parts"
        items={[
          { label: "Home", to: "/" },
          {
            label: clientName ?? "…",
            to: part ? `/clients/${part.client_id}/parts${type !== "final" ? `?type=${type}` : ""}` : "/clients",
          },
          { label: part?.part_number ?? `Part #${partId}` },
        ]}
      />
      <h1>{part?.part_number ?? `Part #${partId}`}</h1>

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
        <span className="datasheet-file-label">Data Sheet — {part?.part_number ?? `Part #${partId}`}</span>
      </button>
      <TemplateEditLink to={`/parts/${partId}/template${type !== "final" ? `?type=${type}` : ""}`} />

      {error && <p className="error">{error}</p>}

      <h2>Inspection History</h2>
      {canDelete && <p className="muted">Right-click an inspection to delete it.</p>}
      {groupByYear(inspections).map(([year, yearInspections]) => (
        <div key={year}>
          <h3>{year}</h3>
          <ul className="card-list">
            {yearInspections.map((i) => (
              <li key={i.id} className="card" onContextMenu={canDelete ? (e) => handleContextMenu(e, i) : undefined}>
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
      {inspections.length === 0 && <p className="muted">No inspections recorded for this part yet.</p>}

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
