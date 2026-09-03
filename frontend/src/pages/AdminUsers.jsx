import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../hooks/useConfirm";
import { ROLE_LABELS } from "../lib/format";

const ROLES = ["operator", "engineer", "qc", "admin"];
// Display/grouping order for the user list -- highest-access first, roughly
// matching org hierarchy, not the create-form's ROLES order above.
const ROLE_GROUP_ORDER = ["admin", "engineer", "qc", "operator"];

const emptyNewUser = { username: "", password: "", full_name: "", role: "qc" };

// Admin-only user management: create/edit users, assign a role, toggle
// active, reset a password, and tag which customers a user is assigned to.
// Customer assignment is informational only (see schema.sql's user_clients
// comment) -- it doesn't restrict what the user can actually see anywhere
// else in the app.
export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  const [newUser, setNewUser] = useState(emptyNewUser);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null); // { full_name, role, active, password, client_ids: Set }
  const [clientQuery, setClientQuery] = useState("");

  const load = () => {
    setLoading(true);
    api
      .getUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.getClients().then(setClients).catch(() => {});
  }, []);

  // users is already sorted by full_name (see GET /api/admin/users), so
  // grouping by role here preserves alphabetical order within each group.
  const groupedUsers = useMemo(() => {
    return ROLE_GROUP_ORDER.map((role) => ({
      role,
      label: ROLE_LABELS[role] ?? role,
      users: users.filter((u) => u.role === role),
    })).filter((g) => g.users.length > 0);
  }, [users]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.password || !newUser.full_name.trim()) return;
    setError(null);
    try {
      await api.createUser(newUser);
      setNewUser(emptyNewUser);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setClientQuery("");
    setEditForm({
      full_name: user.full_name,
      role: user.role,
      active: !!user.active,
      password: "",
      client_ids: new Set(user.client_ids),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
    setClientQuery("");
  };

  const trimmedClientQuery = clientQuery.trim().toLowerCase();
  const filteredClients = trimmedClientQuery
    ? clients.filter((c) => c.name.toLowerCase().includes(trimmedClientQuery))
    : clients;

  const toggleClient = (clientId) => {
    setEditForm((f) => {
      const client_ids = new Set(f.client_ids);
      if (client_ids.has(clientId)) client_ids.delete(clientId);
      else client_ids.add(clientId);
      return { ...f, client_ids };
    });
  };

  // Operates on whatever's currently visible under the search filter, not
  // the full customer list -- so "Select all" after searching "Kawasaki"
  // selects just the matches, not all ~90 customers. With no search active,
  // filteredClients is the full list, so this is a true select/clear-all.
  const selectAllClients = () =>
    setEditForm((f) => ({ ...f, client_ids: new Set([...f.client_ids, ...filteredClients.map((c) => c.id)]) }));
  const clearAllClients = () =>
    setEditForm((f) => {
      const client_ids = new Set(f.client_ids);
      filteredClients.forEach((c) => client_ids.delete(c.id));
      return { ...f, client_ids };
    });

  const saveEdit = async (userId) => {
    setError(null);
    try {
      const payload = { full_name: editForm.full_name, role: editForm.role, active: editForm.active };
      if (editForm.password) payload.password = editForm.password;
      await api.updateUser(userId, payload);
      await api.updateUserClients(userId, Array.from(editForm.client_ids));
      cancelEdit();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (user) => {
    if (!(await confirm(`Delete user "${user.full_name}"? This can't be undone.`))) return;
    setError(null);
    try {
      await api.deleteUser(user.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Home
      </Link>
      <h1>Manage Users</h1>

      <form className="inline-form" onSubmit={handleCreate}>
        <input
          placeholder="Username"
          value={newUser.username}
          onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))}
        />
        <input
          placeholder="Full name"
          value={newUser.full_name}
          onChange={(e) => setNewUser((u) => ({ ...u, full_name: e.target.value }))}
        />
        <input
          type="password"
          placeholder="Password"
          value={newUser.password}
          onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
        />
        <select value={newUser.role} onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button type="submit">Add user</button>
      </form>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        groupedUsers.map((group) => (
          <section key={group.role} className="admin-user-group">
            <h2 className="admin-user-group-heading">
              {group.label} <span className="muted">({group.users.length})</span>
            </h2>
            <ul className="card-list">
              {group.users.map((user) => (
                <li key={user.id} className="card">
                  {editingId === user.id ? (
                    <div className="admin-user-edit">
                      <div className="inline-form">
                        <input
                          value={editForm.full_name}
                          onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                        />
                        <select
                          value={editForm.role}
                          onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        <label className="hundred-percent-toggle">
                          <input
                            type="checkbox"
                            checked={editForm.active}
                            onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                          />
                          Active
                        </label>
                        <input
                          type="password"
                          placeholder="New password (optional)"
                          value={editForm.password}
                          onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                        />
                      </div>

                      <div className="admin-user-clients">
                        <div className="admin-user-clients-header">
                          <div className="account-menu-section-label">
                            Assigned customers ({editForm.client_ids.size}/{clients.length})
                          </div>
                          <div className="row-actions">
                            <button type="button" className="secondary-btn" onClick={selectAllClients}>
                              {trimmedClientQuery ? `Select all (${filteredClients.length})` : "Select all"}
                            </button>
                            <button type="button" className="secondary-btn" onClick={clearAllClients}>
                              {trimmedClientQuery ? `Clear all (${filteredClients.length})` : "Clear all"}
                            </button>
                          </div>
                        </div>

                        <div className="search-bar admin-user-clients-search">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="7" />
                            <path d="m20 20-3.5-3.5" />
                          </svg>
                          <input
                            type="search"
                            placeholder="Search customers..."
                            value={clientQuery}
                            onChange={(e) => setClientQuery(e.target.value)}
                          />
                        </div>

                        <div className="admin-user-clients-grid">
                          {filteredClients.map((c) => (
                            <label key={c.id} className="hundred-percent-toggle">
                              <input
                                type="checkbox"
                                checked={editForm.client_ids.has(c.id)}
                                onChange={() => toggleClient(c.id)}
                              />
                              {c.name}
                            </label>
                          ))}
                          {filteredClients.length === 0 && (
                            <p className="muted">No customers match "{clientQuery.trim()}".</p>
                          )}
                        </div>
                      </div>

                      <div className="row-actions">
                        <button type="button" onClick={() => saveEdit(user.id)}>
                          Save
                        </button>
                        <button type="button" className="secondary-btn" onClick={cancelEdit}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="admin-user-row">
                      <div>
                        <strong>{user.full_name}</strong>
                        <div className="muted">
                          @{user.username}
                          {user.client_ids.length > 0 && ` · ${user.client_ids.length} customer(s) assigned`}
                        </div>
                      </div>
                      <span className={`status status-${user.active ? "active" : "inactive"}`}>
                        {user.active ? "Active" : "Inactive"}
                      </span>
                      <div className="row-actions">
                        <button type="button" className="secondary-btn" onClick={() => startEdit(user)}>
                          Edit
                        </button>
                        {user.id !== currentUser?.id && (
                          <button type="button" className="reject" onClick={() => handleDelete(user)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {users.length === 0 && !loading && <p className="muted">No users yet.</p>}
      {confirmDialog}
    </div>
  );
}
