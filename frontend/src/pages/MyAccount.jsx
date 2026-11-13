import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { rolesLabel, rolesOf } from "../lib/roles";

// Self-service account details, reached from AccountMenu. Read-only for now
// (full name/role/username are admin-managed, see AdminUsers.jsx) except
// email -- the one field a user can set for themselves, since it's just an
// optional contact address, not something that needs admin oversight.
export default function MyAccount() {
  const { user, patchUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(user?.email || "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api.updateEmail(email.trim());
      patchUser({ email: result.email });
      setEmail(result.email || "");
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">My Account</h1>
        <p className="login-subtitle">Your account details.</p>

        <label className="login-field">
          <span>Full name</span>
          <input value={user?.full_name || ""} disabled />
        </label>
        <label className="login-field">
          <span>Username</span>
          <input value={user?.username || ""} disabled />
        </label>
        <label className="login-field">
          <span>{rolesOf(user).length > 1 ? "Roles" : "Role"}</span>
          <input value={rolesLabel(user)} disabled />
        </label>
        <label className="login-field">
          <span>Email (optional)</span>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(false);
            }}
          />
        </label>

        {error && <p className="error">{error}</p>}
        {saved && !error && <p className="success-note">Saved.</p>}

        <button type="submit" disabled={submitting} className="login-submit">
          {submitting ? "Saving..." : "Save email"}
        </button>
        <button type="button" className="secondary-btn login-submit" onClick={() => navigate(-1)}>
          Back
        </button>
      </form>
    </div>
  );
}
