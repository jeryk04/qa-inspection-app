import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

const PIN_LENGTH = 4;
const onlyDigits = (value) => value.replace(/\D/g, "").slice(0, PIN_LENGTH);

// Reached two ways: forced (App.jsx's RequireAuth redirects here whenever
// user.must_change_password is set -- every bulk-imported/admin-created
// account starts this way) or voluntarily, via AccountMenu, for anyone who
// just wants to rotate their own PIN. `forced` only changes the copy and
// removes the "cancel and go back" option -- the API call is identical
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
    if (newPassword.length !== PIN_LENGTH) {
      setError(`New PIN must be exactly ${PIN_LENGTH} digits.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New PINs don't match.");
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
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">{forced ? "Set a new PIN" : "Change your PIN"}</h1>
        <p className="login-subtitle">
          {forced
            ? `Welcome, ${user?.full_name}. Your account still has its temporary PIN -- pick your own before continuing.`
            : "Enter your current PIN and a new one."}
        </p>
        <label className="login-field">
          <span>Current PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={PIN_LENGTH}
            className="login-pin-input"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(onlyDigits(e.target.value))}
            autoFocus
            autoComplete="current-password"
          />
        </label>
        <label className="login-field">
          <span>New PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={PIN_LENGTH}
            className="login-pin-input"
            value={newPassword}
            onChange={(e) => setNewPassword(onlyDigits(e.target.value))}
            autoComplete="new-password"
          />
        </label>
        <label className="login-field">
          <span>Confirm new PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={PIN_LENGTH}
            className="login-pin-input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(onlyDigits(e.target.value))}
            autoComplete="new-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting} className="login-submit">
          {submitting ? "Saving..." : "Save new PIN"}
        </button>
        {!forced && (
          <button type="button" className="secondary-btn login-submit" onClick={() => navigate(-1)}>
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}
