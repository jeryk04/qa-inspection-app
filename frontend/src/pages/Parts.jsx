import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useConfirm } from "../hooks/useConfirm";

const MAX_RESULTS = 30;

export default function Parts() {
  const { clientId } = useParams();
  const [searchParams] = useSearchParams();
  // See Clients.jsx -- carries a non-default inspection type through the
  // picker chain; absent (and thus a no-op) for the normal QC path.
  const type = searchParams.get("type");
  const [parts, setParts] = useState([]);
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

  // in_process goes to the per-part Operations list instead of straight to a
  // Data Sheet -- every other type (including the default, unset "final"
  // case) keeps the existing single-Data-Sheet flow untouched.
  const partHref = (id) => {
    if (type === "in_process") return `/parts/${id}/operations`;
    return type ? `/parts/${id}/inspections?type=${type}` : `/parts/${id}/inspections`;
  };

  const trimmedQuery = query.trim().toLowerCase();
  const visibleParts = useMemo(() => {
    if (!trimmedQuery) return parts;
    return parts.filter(
      (p) =>
        p.part_number.toLowerCase().includes(trimmedQuery) ||
        (p.description && p.description.toLowerCase().includes(trimmedQuery))
    );
  }, [parts, trimmedQuery]);

  return (
    <div className="page">
      <Link to={type ? `/clients?type=${type}` : "/clients"} className="back-link">
        ← Customers
      </Link>
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
