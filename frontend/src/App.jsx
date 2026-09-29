import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import AccountMenu from "./components/AccountMenu";
import Home from "./pages/Home";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import MyAccount from "./pages/MyAccount";
import Clients from "./pages/Clients";
import Parts from "./pages/Parts";
import Inspections from "./pages/Inspections";
import OperationsList from "./pages/OperationsList";
import OperationDetail from "./pages/OperationDetail";
import DataSheetTemplate from "./pages/DataSheetTemplate";
import InspectionCapture from "./pages/InspectionCapture";
import InspectionSheet from "./pages/InspectionSheet";
import InspectionHistory from "./pages/InspectionHistory";
import StatusLookup from "./pages/StatusLookup";
import WorkOrderLookup from "./pages/WorkOrderLookup";
import IncomingInspection from "./pages/IncomingInspection";
import IncomingFolders from "./pages/IncomingFolders";
import AdminTrash from "./pages/AdminTrash";
import AdminUsers from "./pages/AdminUsers";
import "./App.css";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="page">
        <p>Loading...</p>
      </div>
    );
  }
  if (!user) {
    // Keep the query string too -- ?type=setup/samples/in_process is what
    // picks the inspection type, so dropping it sent people back to the
    // wrong type (default in_process) after logging back in.
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }
  // Bulk-imported and admin-created accounts start on a temporary password
  // (see db.js's migration / admin.js) -- block every other route until it's
  // changed, the same way an unauthenticated user is blocked until they log
  // in. Checked here, once, rather than in every page, since every
  // authenticated route already goes through this wrapper.
  if (user.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

function AppShell() {
  // adminView/effectiveRole live in AuthContext (not local state) so every
  // page -- not just this header's nav -- can tell whether an admin is
  // currently previewing another role. Persisted per user (see
  // AuthContext), so a refresh keeps the current view; logout clears it.
  const { user, logout, viewAs: adminView, setViewAs: setAdminView } = useAuth();
  const navigate = useNavigate();

  // Applies a new preview selection (or null, back to Admin's own view) and
  // jumps home so the picked role's Home screen shows immediately.
  const selectView = (role) => {
    setAdminView(role);
    navigate("/");
  };

  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          <img src="/icon-192.png" alt="" width="28" height="28" className="brand-mark" />
          Inspection App
        </Link>
        {user && (
          <nav className="main-nav">
            {/* Customers/History/WO# Lookup moved into AccountMenu's "Browse"
                section -- see that component for the operator-hiding logic
                (it reads effectiveRole itself now, not passed down). */}
            <AccountMenu
              user={user}
              viewAs={adminView}
              onSelectView={selectView}
              onLogout={() => logout()}
            />
          </nav>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePassword forced={!!user?.must_change_password} />
              </RequireAuth>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Home adminView={adminView} setAdminView={setAdminView} />
              </RequireAuth>
            }
          />
          <Route
            path="/account"
            element={
              <RequireAuth>
                <MyAccount />
              </RequireAuth>
            }
          />
          <Route
            path="/clients"
            element={
              <RequireAuth>
                <Clients />
              </RequireAuth>
            }
          />
          <Route
            path="/clients/:clientId/parts"
            element={
              <RequireAuth>
                <Parts />
              </RequireAuth>
            }
          />
          <Route
            path="/parts/:partId/inspections"
            element={
              <RequireAuth>
                <Inspections />
              </RequireAuth>
            }
          />
          <Route
            path="/parts/:partId/operations"
            element={
              <RequireAuth>
                <OperationsList />
              </RequireAuth>
            }
          />
          <Route
            path="/parts/:partId/operations/:operationId"
            element={
              <RequireAuth>
                <OperationDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/parts/:partId/template"
            element={
              <RequireAuth>
                <DataSheetTemplate />
              </RequireAuth>
            }
          />
          <Route
            path="/inspections/:inspectionId"
            element={
              <RequireAuth>
                <InspectionCapture />
              </RequireAuth>
            }
          />
          <Route
            path="/inspections/:inspectionId/sheet"
            element={
              <RequireAuth>
                <InspectionSheet />
              </RequireAuth>
            }
          />
          <Route
            path="/history"
            element={
              <RequireAuth>
                <InspectionHistory />
              </RequireAuth>
            }
          />
          <Route
            path="/status-lookup"
            element={
              <RequireAuth>
                <StatusLookup />
              </RequireAuth>
            }
          />
          <Route
            path="/wo-lookup"
            element={
              <RequireAuth>
                <WorkOrderLookup />
              </RequireAuth>
            }
          />
          <Route
            path="/incoming"
            element={
              <RequireAuth>
                <IncomingInspection />
              </RequireAuth>
            }
          />
          <Route
            path="/incoming/:category"
            element={
              <RequireAuth>
                <IncomingFolders />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/trash"
            element={
              <RequireAuth>
                <RequireAdmin>
                  <AdminTrash />
                </RequireAdmin>
              </RequireAuth>
            }
          />
          <Route
            path="/admin/users"
            element={
              <RequireAuth>
                <RequireAdmin>
                  <AdminUsers />
                </RequireAdmin>
              </RequireAuth>
            }
          />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
