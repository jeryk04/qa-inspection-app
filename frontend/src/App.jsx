import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
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
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return children;
}

function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Which role experience an admin is currently viewing -- null shows
  // AdminMenu. Lives here (not in Home) so the header's "Switch view"
  // control can reset it too. Not persisted: a refresh resets AppShell's
  // state, so admin always lands back on AdminMenu.
  const [adminView, setAdminView] = useState(null);

  const switchView = () => {
    setAdminView(null);
    navigate("/");
  };

  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          QA Inspection App
        </Link>
        {user && (
          <nav className="main-nav">
            <Link to="/clients">Customers</Link>
            <Link to="/history">History</Link>
            {user.role === "admin" && adminView && (
              <button className="secondary-btn" onClick={switchView}>
                Switch view
              </button>
            )}
            <span className="nav-user">{user.full_name}</span>
            <button className="secondary-btn" onClick={() => logout()}>
              Logout
            </button>
          </nav>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Home adminView={adminView} setAdminView={setAdminView} />
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
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}
