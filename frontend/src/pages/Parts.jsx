import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../hooks/useConfirm";
import { incomingBackHref, INCOMING_ONLY_PARTS } from "../lib/incoming";
import PageNav from "../components/PageNav";
import { SETUP_TYPES, SUPPLIER_SETUP_TYPES, operationsListHref, setupState } from "../lib/partSetup";

const MAX_RESULTS = 30;

// Mirrors clients.js's requireRole("qc", "admin", "engineer", "supervisor", "qa_manager")
// on POST /api/parts -- kept as a literal list here (not imported) since
// there's no shared roles module and this is the only other place it's used.
const CAN_MANAGE_CATALOG_ROLES = new Set(["admin", "qc", "engineer", "supervisor", "qa_manager"]);

const BASE_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001/api`;
// Uploaded drawing files are served from the API's origin (see
// DataSheetTemplate.jsx's API_ORIGIN).
const API_ORIGIN = BASE_URL.replace(/\/api$/, "");

// Where clicking an inspection type's chip goes: straight to the template
// that needs setting up. Final/Incoming has one; an operation type with a
// single operation opens that operation's; one with none (an operation has
// to exist before it can have a template) or several opens its operations
// list.
function chipHref(partId, t, status) {
  if (t.key === "final") return `/parts/${partId}/template`;
  const ops = status[t.key];
  if (ops.length === 1) return `/parts/${partId}/template?operation_id=${ops[0].id}&type=${t.type}`;
  return operationsListHref(partId, t);
}

function chipTitle(t, status) {
  if (t.key === "final") return status.final.template ? "Open the Final/Incoming template" : "Set up the Final/Incoming template";
  const ops = status[t.key];
  if (ops.length === 0) return `No ${t.label} operations yet -- add one to set up its template`;
  if (ops.length === 1) return `${ops[0].name}: ${ops[0].template ? "open" : "set up"} its template`;
  return `${ops.length} operations: ${ops.map((o) => `${o.name} ${o.template ? "✓" : "—"}`).join(", ")}`;
}

// One chip per inspection type (✓ set up, n/m operations set up, or —),
// each linking to its template, plus the Final/Incoming drawing: its Rev
// (opens the file) or, when missing, an inline "Attach drawing" form for
// anyone who can edit templates.
function SetupSummary({ partId, status, types, canAttach, onAttached }) {
  const [attaching, setAttaching] = useState(false);
  const [file, setFile] = useState(null);
  const [revision, setRevision] = useState(status.final.revision || "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Same as DataSheetTemplate.jsx's upload: a new template revision carrying
  // the current Find# columns forward, now with the drawing file and Rev.
  const handleAttach = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("part_id", partId);
    formData.append("image", file);
    if (revision.trim()) formData.append("revision_label", revision.trim());
    try {
      await api.uploadDrawing(formData);
      setAttaching(false);
      setFile(null);
      onAttached();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="setup-summary-wrap">
      <span className="setup-summary">
        {types.map((t) => {
          const state = setupState(status, t.key);
          const ops = t.key === "final" ? null : status[t.key];
          const mark =
            state === "ready" ? "✓" : state === "partial" ? `${ops.filter((o) => o.template).length}/${ops.length}` : "—";
          return (
            <Link
              key={t.key}
              to={chipHref(partId, t, status)}
              title={chipTitle(t, status)}
              className={`setup-chip setup-chip-link setup-chip-${state}`}
            >
              {t.short} {mark}
            </Link>
          );
        })}
        {status.final.drawing ? (
          <a
            href={`${API_ORIGIN}${status.final.image_path}`}
            target="_blank"
            rel="noreferrer"
            title="Open the Final/Incoming drawing"
            className="setup-chip setup-chip-link setup-chip-ready"
          >
            Drawing ✓{status.final.revision ? ` · Rev ${status.final.revision}` : " · no Rev"}
          </a>
        ) : canAttach ? (
          <button
            type="button"
            className="setup-chip setup-chip-attach"
            aria-expanded={attaching}
            onClick={() => setAttaching((v) => !v)}
          >
            {attaching ? "Cancel" : "+ Attach drawing"}
          </button>
        ) : (
          <span className="setup-chip setup-chip-none">Drawing —</span>
        )}
      </span>

      {attaching && (
        <form className="setup-attach-form" onSubmit={handleAttach}>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <input
            className="setup-attach-rev"
            placeholder="Rev (e.g. B)"
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
          />
          <button type="submit" disabled={!file || uploading}>
            {uploading ? "Uploading…" : "Attach"}
          </button>
          {error && <span className="error">{error}</span>}
        </form>
      )}
    </div>
  );
}

export default function Parts() {
  const { clientId } = useParams();
  const { effectiveRole } = useAuth();
  const [searchParams] = useSearchParams();
  // See Clients.jsx -- carries a non-default inspection type through the
  // picker chain; absent (and thus a no-op) for the normal QC path.
  const type = searchParams.get("type");
  // See Clients.jsx's isBrowseMode -- only Browse Customers sets this, so
  // "Add part" only ever renders there, never mid-inspection-flow.
  const isBrowseMode = searchParams.get("browse") === "1";
  // Browse Suppliers (Suppliers.jsx) reuses browse mode, showing only what
  // matters for a supplier's part: its Incoming template and drawing.
  const isSupplierMode = isBrowseMode && searchParams.get("supplier") === "1";
  const canManageCatalog = isBrowseMode && CAN_MANAGE_CATALOG_ROLES.has(effectiveRole);
  const [parts, setParts] = useState([]);
  const [clientName, setClientName] = useState(null);
  const [query, setQuery] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState(null);

  const [contextMenu, setContextMenu] = useState(null); // { partId, x, y }
  const [confirm, confirmDialog] = useConfirm();
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const skipBlurSaveRef = useRef(false);

  // Browse Customers only: each part's template/drawing setup per
  // inspection type (lib/partSetup.js), summarized on its card.
  const [setupStatus, setSetupStatus] = useState({});

  const load = () => {
    api.getParts(clientId).then(setParts).catch((e) => setError(e.message));
    if (isBrowseMode) api.getPartsSetupStatus(clientId).then(setSetupStatus).catch(() => {});
  };

  useEffect(() => {
    load();
  }, [clientId]);

  // Needed both to route the "back" link when arrived via Incoming
  // Inspection (see lib/incoming.js) AND, regardless of entry point, to
  // check a part's name against INCOMING_ONLY_PARTS below -- getParts
  // doesn't include the client's own name, and there's no single-client
  // fetch endpoint.
  useEffect(() => {
    api
      .getClients()
      .then((clients) => setClientName(clients.find((c) => String(c.id) === clientId)?.name ?? null))
      .catch(() => {});
  }, [clientId]);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!partNumber.trim()) return;
    try {
      await api.createPart({ client_id: Number(clientId), part_number: partNumber, description });
      setPartNumber("");
      setDescription("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleContextMenu = (e, part) => {
    e.preventDefault();
    setContextMenu({ partId: part.id, x: e.clientX, y: e.clientY });
  };

  const startRename = (part) => {
    setRenamingId(part.id);
    setRenameValue(part.part_number);
    setContextMenu(null);
  };

  const submitRename = async (id) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed) return;
    try {
      await api.updatePart(id, { part_number: trimmed });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const cancelRename = () => {
    skipBlurSaveRef.current = true;
    setRenamingId(null);
  };

  const handleDelete = async (part) => {
    setContextMenu(null);
    if (!(await confirm(`Delete part "${part.part_number}"? This can't be undone.`))) return;
    try {
      await api.deletePart(part.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  // in_process, setup, and samples all go to the per-part Operations list
  // instead of straight to a Data Sheet -- they check a specific
  // manufacturing step (or, for samples, a specific evaluation round), not
  // the whole part, so each operation needs its own Data Sheet Template.
  // Every other type (including the default, unset "final" case) keeps the
  // existing single-Data-Sheet flow untouched.
  const partHref = (id) => {
    // Browse Customers opens the part's setup overview (PartSetup.jsx).
    if (isBrowseMode) return `/parts/${id}/setup${isSupplierMode ? "?supplier=1" : ""}`;
    if (type === "in_process" || type === "setup" || type === "samples") return `/parts/${id}/operations?type=${type}`;
    return type ? `/parts/${id}/inspections?type=${type}` : `/parts/${id}/inspections`;
  };

  const trimmedQuery = query.trim().toLowerCase();
  const visibleParts = useMemo(() => {
    // A "double duty" client (e.g. Kawasaki, TRB) can have a part filed
    // under it purely for Incoming Inspection browsing (see lib/incoming.js)
    // alongside its real manufacturing parts -- only show that entry when
    // actually reached via the /incoming flow, not from Final/Set-up/
    // In-Process, where it isn't a real part to inspect.
    const scoped =
      type === "incoming"
        ? parts
        : parts.filter((p) => !INCOMING_ONLY_PARTS.has(`${clientName}:${p.part_number}`));
    if (!trimmedQuery) return scoped;
    return scoped.filter(
      (p) =>
        p.part_number.toLowerCase().includes(trimmedQuery) ||
        (p.description && p.description.toLowerCase().includes(trimmedQuery))
    );
  }, [parts, trimmedQuery, type, clientName]);

  return (
    <div className="page">
      <PageNav
        backTo={
          type === "incoming"
            ? incomingBackHref(clientName)
            : isSupplierMode
              ? "/suppliers"
              : isBrowseMode
                ? "/clients?browse=1"
                : type
                  ? `/clients?type=${type}`
                  : "/clients"
        }
        backLabel={type === "incoming" ? "Back to Folders" : isSupplierMode ? "Back to Suppliers" : "Back to Customers"}
        items={[
          { label: "Home", to: "/" },
          type === "incoming"
            ? { label: "Folders", to: incomingBackHref(clientName) }
            : isSupplierMode
              ? { label: "Suppliers", to: "/suppliers" }
              : {
                  label: "Customers",
                  to: isBrowseMode ? "/clients?browse=1" : type ? `/clients?type=${type}` : "/clients",
                },
          { label: clientName ?? "…" },
        ]}
      />
      <h1>Parts</h1>

      <div className="search-bar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          placeholder="Search part #..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {canManageCatalog && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            placeholder="Part number"
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
          />
          <input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button type="submit">Add part</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
      <p className="muted">Right-click a part to rename or delete it.</p>
      {isSupplierMode ? (
        <p className="muted setup-legend">
          Incoming: ✓ template set up · — not set up. Click it to open or set up the template. Drawing shows the
          attached drawing's Rev.
        </p>
      ) : (
        isBrowseMode && (
          <p className="muted setup-legend">
            Templates: ✓ set up · 1/2 = operations set up · — not set up. Click a type to open or set up its template.
            Drawing = the Final/Incoming drawing and its Rev. Click a part number for every operation's details.
          </p>
        )
      )}
      <ul className="card-list">
        {visibleParts.slice(0, MAX_RESULTS).map((p) => (
          <li key={p.id} className="card" onContextMenu={(e) => handleContextMenu(e, p)}>
            {renamingId === p.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  if (skipBlurSaveRef.current) {
                    skipBlurSaveRef.current = false;
                    return;
                  }
                  submitRename(p.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") cancelRename();
                }}
              />
            ) : (
              <>
                <Link to={partHref(p.id)}>
                  <strong>{p.part_number}</strong>
                  {p.description && <span className="muted"> · {p.description}</span>}
                </Link>
                {/* Outside the part's Link -- each chip is its own link. */}
                {isBrowseMode && setupStatus[p.id] && (
                  <SetupSummary
                    partId={p.id}
                    status={setupStatus[p.id]}
                    types={isSupplierMode ? SUPPLIER_SETUP_TYPES : SETUP_TYPES}
                    canAttach={canManageCatalog}
                    onAttached={load}
                  />
                )}
              </>
            )}
          </li>
        ))}
        {parts.length === 0 && <p className="muted">This customer has no parts yet.</p>}
        {parts.length > 0 && visibleParts.length === 0 && <p className="muted">No parts match "{query.trim()}".</p>}
        {visibleParts.length > MAX_RESULTS && (
          <p className="muted">+{visibleParts.length - MAX_RESULTS} more — refine your search.</p>
        )}
      </ul>

      {contextMenu && (
        <ul className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <li onClick={() => startRename(parts.find((p) => p.id === contextMenu.partId))}>Rename</li>
          <li
            className="context-menu-danger"
            onClick={() => handleDelete(parts.find((p) => p.id === contextMenu.partId))}
          >
            Delete
          </li>
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
