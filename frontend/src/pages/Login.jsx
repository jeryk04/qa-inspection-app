import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const from = location.state?.from || "/";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src="/icon-192.png" alt="" className="login-mark" />
        <h1 className="login-title">Inspection App</h1>
        <p className="login-subtitle">Sign in to continue.</p>

        <label className="login-field">
          <span>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </label>
        <label className="login-field">
          <span>PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="\d*"
            maxLength={4}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className="login-pin-input"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={submitting} className="login-submit">
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
