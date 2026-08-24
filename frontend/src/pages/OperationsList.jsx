import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

const CAN_CREATE_ROLES = ["qc", "admin", "engineer"];

// The in-process counterpart to Parts.jsx's "click a part to see its Data
// Sheet" -- here a part fans out into its operations (e.g. "Bending",
// "Chamfer"), each with its own Data Sheet Template and inspection history.
export default function OperationsList() {
  const { partId } = useParams();
  const { user } = useAuth();
  const canCreate = CAN_CREATE_ROLES.includes(user?.role);

  const [part, setPart] = useState(null);
  const [operations, setOperations] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const skipBlurSaveRef = useRef(false);

  const load = () => {
    api.getPart(partId).then(setPart).catch((e) => setError(e.message));
    api.getOperations(partId).then(setOperations).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [partId]);

  const submitCreate = async () => {
    const name = newName.trim();
    setCreating(false);
    if (!name) return;
    setError(null);
    try {
      await api.createOperation(partId, { name });
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

  return (
    <div className="page">
      <Link
        to={part ? `/clients/${part.client_id}/parts?type=in_process` : "/clients?type=in_process"}
        className="back-link"
      >
        ← Parts
      </Link>
      <h1>Operations — {part?.part_number ?? `Part #${partId}`}</h1>
      <p className="muted">Select an operation to record an in-process inspection for it.</p>
      {error && <p className="error">{error}</p>}

      {operations.length === 0 && !creating && (
        <p className="muted">
          {canCreate ? "No operations yet for this part." : "No operations set up yet. Ask QC to add one."}
        </p>
      )}

      <div className="type-grid">
        {operations.map((op) => (
          <Link key={op.id} to={`/parts/${partId}/operations/${op.id}`} className="type-card">
            <strong>{op.name}</strong>
          </Link>
        ))}
        {canCreate &&
          (creating ? (
            <div className="type-card">
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
            <button type="button" className="type-card" onClick={() => setCreating(true)}>
              <strong>+ New operation</strong>
            </button>
          ))}
      </div>
    </div>
  );
}
