import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

export default function Parts() {
  const { clientId } = useParams();
  const [parts, setParts] = useState([]);
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState(null);

  const [contextMenu, setContextMenu] = useState(null); // { partId, x, y }
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
    if (!window.confirm(`Delete part "${part.part_number}"? This can't be undone.`)) return;
    try {
      await api.deletePart(part.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <Link to="/clients" className="back-link">
        ← Customers
      </Link>
      <h1>Parts</h1>

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
        {parts.map((p) => (
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
              <Link to={`/parts/${p.id}/inspections`}>
                <strong>{p.part_number}</strong>
                {p.description && <span className="muted"> · {p.description}</span>}
              </Link>
            )}
          </li>
        ))}
        {parts.length === 0 && <p className="muted">This customer has no parts yet.</p>}
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
    </div>
  );
}
