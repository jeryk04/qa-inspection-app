import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [contextMenu, setContextMenu] = useState(null); // { clientId, x, y }
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const skipBlurSaveRef = useRef(false);

  const load = () => {
    setLoading(true);
    api
      .getClients()
      .then(setClients)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

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
    if (!name.trim()) return;
    try {
      await api.createClient({ name });
      setName("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleContextMenu = (e, client) => {
    e.preventDefault();
    setContextMenu({ clientId: client.id, x: e.clientX, y: e.clientY });
  };

  const startRename = (client) => {
    setRenamingId(client.id);
    setRenameValue(client.name);
    setContextMenu(null);
  };

  const submitRename = async (id) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed) return;
    try {
      await api.updateClient(id, { name: trimmed });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const cancelRename = () => {
    skipBlurSaveRef.current = true;
    setRenamingId(null);
  };

  const handleDelete = async (client) => {
    setContextMenu(null);
    if (!window.confirm(`Delete customer "${client.name}"? This can't be undone.`)) return;
    try {
      await api.deleteClient(client.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <h1>Customers</h1>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          placeholder="Customer name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">Add customer</button>
      </form>

      {error && <p className="error">{error}</p>}
      <p className="muted">Right-click a customer to rename or delete it.</p>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul className="card-list">
          {clients.map((c) => (
            <li key={c.id} className="card" onContextMenu={(e) => handleContextMenu(e, c)}>
              {renamingId === c.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (skipBlurSaveRef.current) {
                      skipBlurSaveRef.current = false;
                      return;
                    }
                    submitRename(c.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.target.blur();
                    if (e.key === "Escape") cancelRename();
                  }}
                />
              ) : (
                <Link to={`/clients/${c.id}/parts`}>
                  <strong>{c.name}</strong>
                </Link>
              )}
            </li>
          ))}
          {clients.length === 0 && <p className="muted">No customers yet.</p>}
        </ul>
      )}

      {contextMenu && (
        <ul className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <li onClick={() => startRename(clients.find((c) => c.id === contextMenu.clientId))}>Rename</li>
          <li
            className="context-menu-danger"
            onClick={() => handleDelete(clients.find((c) => c.id === contextMenu.clientId))}
          >
            Delete
          </li>
        </ul>
      )}
    </div>
  );
}
