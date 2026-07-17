import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Clients from "./pages/Clients";
import Parts from "./pages/Parts";
import Inspections from "./pages/Inspections";
import DataSheetTemplate from "./pages/DataSheetTemplate";
import InspectionCapture from "./pages/InspectionCapture";
import InspectionSheet from "./pages/InspectionSheet";
import InspectionHistory from "./pages/InspectionHistory";
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
                <Home />
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
