import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/client";

const AuthContext = createContext(null);

// "Switch view" is persisted per user so a refresh keeps the previewed role.
// It used to reset to null on every reload, which silently flipped an admin
// previewing as Operator back to admin -- and OperationsList.jsx maps any
// non-operator role to the QC In-Process list, so the page jumped from the
// Operator's operations to QC's. Storage can be unavailable (private mode,
// blocked site data), so every access is best-effort.
const viewAsKey = (userId) => `viewAs:${userId}`;

function readViewAs(u) {
  if (!u) return null;
  try {
    return localStorage.getItem(viewAsKey(u.id)) || null;
  } catch {
    return null;
  }
}

function writeViewAs(u, role) {
  if (!u) return;
  try {
    if (role) localStorage.setItem(viewAsKey(u.id), role);
    else localStorage.removeItem(viewAsKey(u.id));
  } catch {
    // Not persisted -- still applies for this page load.
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Which role experience an admin is currently previewing via "Switch
  // view" (see AccountMenu/Home) -- null means admin sees their own
  // AdminMenu. Lives here, not in AppShell, so every page can tell whether
  // it should behave like the previewed role instead of just the nav.
  const [viewAs, setViewAsState] = useState(null);

  // Restores viewAs in the same render as user, so no page ever sees the
  // restored user with a not-yet-restored view (which would fetch the wrong
  // operation list first).
  const applyUser = (u) => {
    setViewAsState(readViewAs(u));
    setUser(u);
  };

  useEffect(() => {
    api
      .me()
      .then(applyUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const setViewAs = (role) => {
    setViewAsState(role);
    writeViewAs(user, role);
  };

  const login = async (username, password) => {
    const loggedInUser = await api.login(username, password);
    applyUser(loggedInUser);
    return loggedInUser;
  };

  const logout = async () => {
    await api.logout();
    writeViewAs(user, null);
    setViewAsState(null);
    setUser(null);
  };

  // Called after a successful self-service password change so the forced
  // must_change_password redirect (see App.jsx's RequireAuth) clears
  // immediately, without a full re-login.
  const clearMustChangePassword = () => {
    setUser((u) => (u ? { ...u, must_change_password: false } : u));
  };

  // Called after a self-service field save (currently just email, see
  // MyAccount.jsx) that returns the new value directly -- merges it into
  // the cached user instead of a full /auth/me round trip.
  const patchUser = (fields) => {
    setUser((u) => (u ? { ...u, ...fields } : u));
  };

  // What role a page should behave as -- an admin previewing "as operator"
  // should see exactly what an operator sees, not admin's own unrestricted
  // view. Non-admins always just get their own role.
  const effectiveRole = user?.role === "admin" ? viewAs ?? "admin" : user?.role;

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, viewAs, setViewAs, effectiveRole, clearMustChangePassword, patchUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
