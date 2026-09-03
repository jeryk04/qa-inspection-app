import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Which role experience an admin is currently previewing via "Switch
  // view" (see AccountMenu/Home) -- null means admin sees their own
  // AdminMenu. Lives here, not in AppShell, so every page can tell whether
  // it should behave like the previewed role instead of just the nav.
  const [viewAs, setViewAs] = useState(null);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const loggedInUser = await api.login(username, password);
    setUser(loggedInUser);
    return loggedInUser;
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  // Called after a successful self-service password change so the forced
  // must_change_password redirect (see App.jsx's RequireAuth) clears
  // immediately, without a full re-login.
  const clearMustChangePassword = () => {
    setUser((u) => (u ? { ...u, must_change_password: false } : u));
  };

  // What role a page should behave as -- an admin previewing "as operator"
  // should see exactly what an operator sees, not admin's own unrestricted
  // view. Non-admins always just get their own role.
  const effectiveRole = user?.role === "admin" ? viewAs ?? "admin" : user?.role;

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, viewAs, setViewAs, effectiveRole, clearMustChangePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
