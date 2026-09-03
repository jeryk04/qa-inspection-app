import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

// Reached two ways: forced (App.jsx's RequireAuth redirects here whenever
// user.must_change_password is set -- every bulk-imported/admin-created
// account starts this way) or voluntarily, via AccountMenu, for anyone who
// just wants to rotate their own password. `forced` only changes the copy
// and removes the "cancel and go back" option -- the API call is identical
// either way.
export default function ChangePassword({ forced = false }) {
  const { user, clearMustChangePassword } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      clearMustChangePassword();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page login-page">
      <h1>{forced ? "Set a new password" : "Change your password"}</h1>
      <p className="muted">
        {forced
          ? `Welcome, ${user?.full_name}. Your account still has its temporary password -- pick your own before continuing.`
          : "Enter your current password and a new one."}
      </p>
      <form className="login-form" onSubmit={handleSubmit}>
        <label>
          <span className="muted">Current password</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          <span className="muted">New password</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <label>
          <span className="muted">Confirm new password</span>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Save new password"}
        </button>
        {!forced && (
          <button type="button" className="secondary-btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}
