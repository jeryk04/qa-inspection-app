import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { hasAnyRole } from "../lib/roles";
import { inspectionLabel, resultStatus, resultLabel } from "../lib/format";
import { useConfirm } from "../hooks/useConfirm";
import PageNav from "../components/PageNav";
import TemplateEditLink from "../components/TemplateEditLink";

// Matches DataSheetTemplate.jsx's own guard.
const TEMPLATE_EDIT_ROLES = ["qc", "admin", "engineer", "supervisor", "qa_manager"];
// This deletes any inspection (not the operation) -- matches backend/src/
// routes/inspections.js's DELETE /:id, where only admin/supervisor can erase
// a sheet with recorded data. QC, and an Operator on their own In-Process
// list, can only discard blank ones (see canDiscardBlank below).
const CAN_DELETE_ROLES = ["admin", "supervisor", "qa_manager"];

// Mirrors Inspections.jsx's "Data Sheet folder + history" structure, scoped
// to one operation_id instead of a part's Final drawing. See Inspections.jsx
// for the shared concept; kept as a separate component (not a parameterized
// reuse of Inspections.jsx) since the two pages are wired to different route
// params (partId only vs. partId+operationId) and Inspections.jsx was left
// untouched by design for this step.
//
// Generic over ?type= (in_process, setup, or samples) -- Set-up, In-Process,
// and Samples each have their own independent operations + Data Sheet
// Templates for the same part (see schema.sql's operations.scope comment),
// so the operationId this page is reached with is already scoped correctly
// by OperationsList.jsx; this just needs ?type= to pick the matching Data
// Sheet history and label. Defaults to "in_process" since that's the only
// type this page served before Set-up Inspection was added.
const TYPE_LABELS = { in_process: "In-Process", setup: "Set-up", samples: "Samples" };

export default function OperationDetail() {
  const { partId, operationId } = useParams();
  const { user } = useAuth();
  const canEditTemplate = hasAnyRole(user, TEMPLATE_EDIT_ROLES);
  const canDelete = hasAnyRole(user, CAN_DELETE_ROLES);
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") || "in_process";
  const canDiscardBlank =
    canDelete || hasAnyRole(user, ["qc"]) || (hasAnyRole(user, ["operator"]) && type === "in_process");
  const typeLabel = TYPE_LABELS[type] ?? type;
  const navigate = useNavigate();
  const [part, setPart] = useState(null);
  const [clientName, setClientName] = useState(null);
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
      .getInspections({ operation_id: operationId, type })
      .then(setInspections)
      .catch((e) => setError(e.message));
    api.getOperationDrawings(operationId).then(setDrawings).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [partId, operationId, type]);

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

  // Blank sheets (opened, nothing recorded -- see IS_BLANK_SQL in the
  // backend) get a visible Discard button for the wider set of roles below,
  // since right-click isn't a thing on the shop-floor tablets.
  const handleDiscard = async (inspection) => {
    if (!(await confirm("Discard this empty Data Sheet? Nothing has been recorded on it."))) return;
    try {
      await api.deleteInspection(inspection.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (inspection) => {
    setContextMenu(null);
    if (!(await confirm("Delete this inspection? An admin can restore it from Recently Deleted if needed."))) return;
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
        type,
      });
      navigate(`/inspections/${inspection.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setOpening(false);
    }
  };

  // An Operator In-Process operation opened by QC/admin (see
  // OperationsList.jsx's ?scope=) goes back to that same list, not QC's.
  const listHref = `/parts/${partId}/operations?type=${type}${
    operation?.scope === "in_process_operator" ? "&scope=in_process_operator" : ""
  }`;

  return (
    <div className="page">
      <PageNav
        backTo={listHref}
        backLabel="Back to Operations"
        items={[
          { label: "Home", to: "/" },
          { label: clientName ?? "…", to: part ? `/clients/${part.client_id}/parts?type=${type}` : "/clients" },
          { label: part?.part_number ?? `Part #${partId}`, to: listHref },
          { label: operation?.name ?? "Operation" },
        ]}
      />
      <h1>
        {typeLabel} — {operation?.name ?? "Operation"} — {part?.part_number ?? `Part #${partId}`}
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
        <span className="datasheet-file-label">
          {typeLabel} Data Sheet — {operation?.name ?? "Operation"}
        </span>
      </button>
      {canEditTemplate && (
        <TemplateEditLink to={`/parts/${partId}/template?operation_id=${operationId}&type=${type}`} />
      )}

      {error && <p className="error">{error}</p>}

      <h2>{typeLabel} Inspection History</h2>
      {canDelete && <p className="muted">Right-click an inspection to delete it.</p>}
      {groupByYear(inspections).map(([year, yearInspections]) => (
        <div key={year}>
          <h3>{year}</h3>
          <ul className="card-list">
            {yearInspections.map((i) => (
              <li
                key={i.id}
                className="card card-row"
                onContextMenu={canDelete ? (e) => handleContextMenu(e, i) : undefined}
              >
                <Link to={`/inspections/${i.id}`}>
                  <strong>{inspectionLabel(i)}</strong>
                  <span className="muted"> · </span>
                  <span className={`status status-${resultStatus(i)}`}>{resultLabel(resultStatus(i))}</span>
                  {!!i.is_blank && <span className="muted blank-note"> · nothing recorded</span>}
                </Link>
                {!!i.is_blank && canDiscardBlank && (
                  <button type="button" className="discard-btn" onClick={() => handleDiscard(i)}>
                    Discard
                  </button>
                )}
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
