import { useEffect, useState } from "react";
import { api } from "../api/client";
import PageNav from "../components/PageNav";
import { useConfirm } from "../hooks/useConfirm";
import { timeAgo } from "../lib/format";

const ENTITY_LABELS = { operation: "Operation" };

// Admin-only recycle bin -- lists deleted_items still awaiting recovery
// (see backend/src/lib/trash.js). Today the only entity_type that lands
// here is 'operation', since deleting one now cascades its Data Sheet
// Template and inspection history instead of being blocked (see
// OperationsList.jsx's delete confirm).
export default function AdminTrash() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = () => {
    setLoading(true);
    api
      .getTrash()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRestore = async (item) => {
    setError(null);
    try {
      await api.restoreTrash(item.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handlePurge = async (item) => {
    if (!(await confirm(`Permanently delete "${item.label}" from the recycle bin? This can't be undone.`))) return;
    setError(null);
    try {
      await api.purgeTrash(item.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <PageNav backTo="/" backLabel="Back to Home" items={[{ label: "Home", to: "/" }, { label: "Recently Deleted" }]} />
      <h1>Recently Deleted</h1>
      <p className="muted">Items deleted from the app can be restored here.</p>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul className="card-list">
          {items.map((item) => (
            <li key={item.id} className="card trash-card">
              <div>
                <strong>{item.label}</strong>
                <div className="muted">
                  {ENTITY_LABELS[item.entity_type] ?? item.entity_type} · deleted by{" "}
                  {item.deleted_by_name || "unknown"} · {timeAgo(item.deleted_at)}
                </div>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => handleRestore(item)}>
                  Restore
                </button>
                <button type="button" className="reject" onClick={() => handlePurge(item)}>
                  Delete permanently
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 && <p className="muted">Nothing in the recycle bin.</p>}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
