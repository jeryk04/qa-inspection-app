import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import PageNav from "../components/PageNav";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../hooks/useConfirm";
import { ROLE_LABELS, formatDateTime } from "../lib/format";

const ROLES = ["operator", "engineer", "qc", "supervisor", "admin"];
// Sort order for the user table -- highest-access first, roughly matching
// org hierarchy, not the create-form's ROLES order above. Supervisor sits
// just under admin -- it exists mainly to delete an already-saved
// inspection, a permission QC itself doesn't have (see inspections.js's
// DELETE /:id).
const ROLE_GROUP_ORDER = ["admin", "supervisor", "engineer", "qc", "operator"];

const emptyNewUser = { username: "", password: "", full_name: "", role: "qc", email: "" };

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

// Admin-only user management: create/edit users, assign a role, toggle
// active, reset a password, and tag which customers a user is assigned to.
// For an Operator account, this customer assignment is a real access
// restriction -- an Operator can only browse/create/view/edit In-Process
// work for a customer checked here (see backend/src/lib/operatorAccess.js
// and schema.sql's user_clients comment). Every other role is unrestricted
// by customer regardless of what's checked here.
export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  const [showCreateForm, setShowCreateForm] = useState(false);
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

  // users is already sorted by full_name (see GET /api/admin/users) -- sort
  // by role group on top of that so higher-access roles cluster together,
  // same ordering the old role-sectioned layout gave for free.
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const roleDiff = ROLE_GROUP_ORDER.indexOf(a.role) - ROLE_GROUP_ORDER.indexOf(b.role);
      if (roleDiff !== 0) return roleDiff;
      return a.full_name.localeCompare(b.full_name);
    });
  }, [users]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.password || !newUser.full_name.trim()) return;
    setError(null);
    try {
      await api.createUser(newUser);
      setNewUser(emptyNewUser);
      setShowCreateForm(false);
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
      email: user.email || "",
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
      const payload = {
        full_name: editForm.full_name,
        role: editForm.role,
        active: editForm.active,
        email: editForm.email.trim(),
      };
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
      <PageNav backTo="/" backLabel="Back to Home" items={[{ label: "Home", to: "/" }, { label: "User Management" }]} />

      <div className="admin-users-header">
        <h1>User Management</h1>
        <button type="button" onClick={() => setShowCreateForm((v) => !v)}>
          {showCreateForm ? "Cancel" : "+ Add User"}
        </button>
      </div>

      {showCreateForm && (
        <form className="inline-form card admin-create-user-panel" onSubmit={handleCreate}>
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
            type="email"
            placeholder="Email (optional)"
            value={newUser.email}
            onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
          />
          <input
            type="password"
            placeholder="PIN (4 digits)"
            inputMode="numeric"
            pattern="\d*"
            maxLength={4}
            value={newUser.password}
            onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
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
      )}

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className="admin-users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.map((user) =>
              editingId === user.id ? (
                <tr key={user.id}>
                  <td colSpan={6}>
                    <div className="admin-user-edit">
                      <div className="inline-form">
                        <input
                          value={editForm.full_name}
                          onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                        />
                        <input
                          type="email"
                          placeholder="Email (optional)"
                          value={editForm.email}
                          onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
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
                          placeholder="New PIN (optional)"
                          inputMode="numeric"
                          pattern="\d*"
                          maxLength={4}
                          value={editForm.password}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, password: e.target.value.replace(/\D/g, "").slice(0, 4) }))
                          }
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
                  </td>
                </tr>
              ) : (
                <tr key={user.id}>
                  <td>
                    <strong>{user.full_name}</strong>
                    {user.id === currentUser?.id && (
                      <span className="scope-badge scope-badge-neutral admin-user-you-badge">You</span>
                    )}
                    <div className="muted">
                      @{user.username}
                      {user.email && ` · ${user.email}`}
                      {user.client_ids.length > 0 && ` · ${user.client_ids.length} customer(s) assigned`}
                    </div>
                  </td>
                  <td>
                    <span className={`role-badge role-badge-${user.role}`}>{ROLE_LABELS[user.role] ?? user.role}</span>
                  </td>
                  <td>
                    <span className={`status status-${user.active ? "active" : "inactive"}`}>
                      {user.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{formatDateTime(user.last_login)}</td>
                  <td>{formatDateTime(user.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-btn" title="Edit" onClick={() => startEdit(user)}>
                        <EditIcon />
                      </button>
                      {user.id !== currentUser?.id && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          title="Delete"
                          onClick={() => handleDelete(user)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            )}
            {sortedUsers.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="muted">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {confirmDialog}
    </div>
  );
}
