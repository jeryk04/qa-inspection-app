import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../hooks/useConfirm";
import { incomingBackHref, INCOMING_ONLY_PARTS } from "../lib/incoming";
import PageNav from "../components/PageNav";

const MAX_RESULTS = 30;

// Mirrors clients.js's requireRole("qc", "admin", "engineer", "supervisor")
// on POST /api/parts -- kept as a literal list here (not imported) since
// there's no shared roles module and this is the only other place it's used.
const CAN_MANAGE_CATALOG_ROLES = new Set(["admin", "qc", "engineer", "supervisor"]);

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

  const load = () => {
    api.getParts(clientId).then(setParts).catch((e) => setError(e.message));
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
            : isBrowseMode
              ? "/clients?browse=1"
              : type
                ? `/clients?type=${type}`
                : "/clients"
        }
        backLabel={type === "incoming" ? "Back to Folders" : "Back to Customers"}
        items={[
          { label: "Home", to: "/" },
          type === "incoming"
            ? { label: "Folders", to: incomingBackHref(clientName) }
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
              <Link to={partHref(p.id)}>
                <strong>{p.part_number}</strong>
                {p.description && <span className="muted"> · {p.description}</span>}
              </Link>
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
