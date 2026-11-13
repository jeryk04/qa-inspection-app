import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { hasAnyRole } from "../lib/roles";
import { useConfirm } from "../hooks/useConfirm";
import PageNav from "../components/PageNav";

const CAN_CREATE_ROLES = ["qc", "admin", "engineer", "supervisor", "qa_manager"];
// Delete is more destructive than rename/create, so it's held to the
// tighter qc/admin bar used everywhere else (parts, drawings) -- an engineer
// can still set up and rename operations, just not remove one. This deletes
// the operation itself, not an inspection -- unlike inspections.js's DELETE
// /:id, qc keeps access here.
const CAN_DELETE_ROLES = ["qc", "admin", "supervisor", "qa_manager"];

// Set-up, the Operator's In-Process, QC's own separate In-Process, and
// Samples each have their own fully independent operations + Data Sheet
// Templates for the same part now (see schema.sql's operations.scope
// comment); the only thing that has to match between them is the
// customer/part number, not this list. There's only one ?type=in_process
// URL (Home.jsx routes both QC's "In-Process Inspection" card and the
// Operator's "Start in-process inspection" card to it) -- effectiveRole
// below is what actually tells the two apart, since the URL alone can't.
// Samples doesn't need that split (it's QC-only, like Set-up), so it's a
// flat type === "samples" check same as Set-up's.
const SCOPE_LABELS = {
  setup: "Set-up",
  in_process_operator: "In-Process (Operator)",
  in_process_qc: "In-Process (QC)",
  samples: "Samples",
};

// Color-codes the scope badge next to the page title -- a quick, consistent
// visual tell for which of the four independent lists you're looking at,
// reusing the app's existing status-tone tokens instead of inventing new
// colors (see .status-* in App.css).
const SCOPE_TONES = { setup: "neutral", in_process_operator: "ok", in_process_qc: "conditional", samples: "warn" };

function OperationIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 10v4M17 10v4" />
    </svg>
  );
}

// The operation-scoped counterpart to Parts.jsx's "click a part to see its
// Data Sheet" -- here a part fans out into its operations (e.g. "Bending",
// "Chamfer"), scoped to whichever of the three independent lists this page
// was opened for. Deleting or renaming here only ever touches that one
// list -- it never affects either of the other two, even for an operation
// with the same name on the same part.
export default function OperationsList() {
  const { partId } = useParams();
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") || "in_process";
  const { user, effectiveRole } = useAuth();
  // ?scope=in_process_operator lets QC/admin open the Operator's In-Process
  // list (to set up its templates, e.g. from Browse Customers' PartSetup.jsx)
  // -- ignored for an Operator, who only ever has their own list.
  const requestedScope = searchParams.get("scope");
  const scope =
    type === "setup"
      ? "setup"
      : type === "samples"
        ? "samples"
        : effectiveRole === "operator"
          ? "in_process_operator"
          : requestedScope === "in_process_operator"
            ? "in_process_operator"
            : "in_process_qc";
  const scopeLabel = SCOPE_LABELS[scope];
  const canCreate = hasAnyRole(user, CAN_CREATE_ROLES);
  const canDelete = hasAnyRole(user, CAN_DELETE_ROLES);

  const [part, setPart] = useState(null);
  const [clientName, setClientName] = useState(null);
  const [operations, setOperations] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const skipBlurSaveRef = useRef(false);
  const [confirm, confirmDialog] = useConfirm();
  const [contextMenu, setContextMenu] = useState(null); // { operationId, x, y }
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  const load = () => {
    api.getPart(partId).then(setPart).catch((e) => setError(e.message));
    api.getOperations(partId, scope).then(setOperations).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [partId, scope]);

  // For the breadcrumb trail only -- getPart doesn't include the client's
  // name (see Parts.jsx's own client-name fetch for the same reason).
  useEffect(() => {
    if (!part?.client_id) return;
    api.getClient(part.client_id).then((c) => setClientName(c.name)).catch(() => {});
  }, [part?.client_id]);

  const submitCreate = async () => {
    const name = newName.trim();
    setCreating(false);
    if (!name) return;
    setError(null);
    try {
      await api.createOperation(partId, { name, scope });
      setNewName("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const cancelCreate = () => {
    skipBlurSaveRef.current = true;
    setCreating(false);
    setNewName("");
  };

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

  const handleContextMenu = (e, op) => {
    if (!canCreate) return;
    e.preventDefault();
    setContextMenu({ operationId: op.id, x: e.clientX, y: e.clientY });
  };

  const startRename = (op) => {
    setRenamingId(op.id);
    setRenameValue(op.name);
    setContextMenu(null);
  };

  const submitRename = async (id) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed) return;
    setError(null);
    try {
      await api.updateOperation(partId, id, { name: trimmed });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const cancelRename = () => {
    skipBlurSaveRef.current = true;
    setRenamingId(null);
  };

  const handleDelete = async (op) => {
    setContextMenu(null);
    if (
      !(await confirm(
        `Delete operation "${op.name}"? This deletes its Data Sheet Template and all inspection records. An admin can undo this from Recently Deleted.`
      ))
    )
      return;
    setError(null);
    try {
      await api.deleteOperation(partId, op.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const backHref = part ? `/clients/${part.client_id}/parts?type=${type}` : `/clients?type=${type}`;

  return (
    <div className="page">
      <PageNav
        backTo={backHref}
        backLabel="Back to Parts"
        items={[
          { label: "Home", to: "/" },
          { label: clientName ?? "…", to: backHref },
          { label: part?.part_number ?? `Part #${partId}` },
        ]}
      />

      <div className="page-title-row">
        <h1>Operations — {part?.part_number ?? `Part #${partId}`}</h1>
        <span className={`scope-badge scope-badge-${SCOPE_TONES[scope]}`}>{scopeLabel}</span>
      </div>
      <p className="muted">Select an operation to record an inspection for it.</p>
      {error && <p className="error">{error}</p>}

      {operations.length === 0 && !creating && (
        <p className="muted">
          {canCreate
            ? `No ${scopeLabel} operations yet for this part.`
            : `No ${scopeLabel} operations set up yet. Ask QC to add one.`}
        </p>
      )}
      {canCreate && operations.length > 0 && <p className="muted">Right-click an operation to rename or delete it.</p>}

      <div className="operation-grid">
        {operations.map((op) =>
          renamingId === op.id ? (
            <div key={op.id} className="operation-card">
              <input
                autoFocus
                className="spec-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  if (skipBlurSaveRef.current) {
                    skipBlurSaveRef.current = false;
                    return;
                  }
                  submitRename(op.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") cancelRename();
                }}
              />
            </div>
          ) : (
            <Link
              key={op.id}
              to={`/parts/${partId}/operations/${op.id}?type=${type}`}
              className="operation-card"
              onContextMenu={(e) => handleContextMenu(e, op)}
            >
              <span className="operation-card-icon">
                <OperationIcon />
              </span>
              <strong>{op.name}</strong>
            </Link>
          )
        )}
        {canCreate &&
          (creating ? (
            <div className="operation-card">
              <input
                autoFocus
                className="spec-input"
                value={newName}
                placeholder="Operation name"
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => {
                  if (skipBlurSaveRef.current) {
                    skipBlurSaveRef.current = false;
                    return;
                  }
                  submitCreate();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") cancelCreate();
                }}
              />
            </div>
          ) : (
            <button type="button" className="operation-card operation-card-new" onClick={() => setCreating(true)}>
              <span className="operation-card-icon operation-card-icon-new">+</span>
              <strong>New operation</strong>
            </button>
          ))}
      </div>

      {contextMenu && (
        <ul className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <li onClick={() => startRename(operations.find((op) => op.id === contextMenu.operationId))}>Rename</li>
          {canDelete && (
            <li
              className="context-menu-danger"
              onClick={() => handleDelete(operations.find((op) => op.id === contextMenu.operationId))}
            >
              Delete
            </li>
          )}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
