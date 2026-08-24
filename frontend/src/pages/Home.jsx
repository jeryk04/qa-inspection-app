import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const INSPECTION_TYPES = [
  { key: "final", label: "Final Inspection", enabled: true, to: "/clients" },
  { key: "in_process", label: "In-Process Inspection", enabled: true, to: "/clients?type=in_process" },
  { key: "setup", label: "Set-up Inspection", enabled: false },
  { key: "incoming", label: "Incoming Inspection", enabled: false },
];

function QcHome() {
  return (
    <div className="page">
      <h1>Select Inspection Type</h1>
      <div className="type-grid">
        {INSPECTION_TYPES.map((t) =>
          t.enabled ? (
            <Link key={t.key} to={t.to} className="type-card">
              <strong>{t.label}</strong>
            </Link>
          ) : (
            <div key={t.key} className="type-card type-card-disabled">
              <strong>{t.label}</strong>
              <span className="type-card-badge">Coming soon</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function OperatorHome() {
  return (
    <div className="page">
      <h1>Operator Home</h1>
      <div className="type-grid">
        <Link to="/clients?type=in_process" className="type-card">
          <strong>Start in-process inspection</strong>
        </Link>
        <Link to="/status-lookup" className="type-card">
          <strong>Check approval status</strong>
        </Link>
      </div>
    </div>
  );
}

function EngineerHome() {
  return (
    <div className="page">
      <h1>Engineer Dashboard</h1>
      <p className="muted">Coming soon.</p>
    </div>
  );
}

const ADMIN_VIEWS = [
  { key: "qc", label: "QC Inspector" },
  { key: "operator", label: "Operator" },
  { key: "engineer", label: "Engineer" },
];

// Lets admin enter any of the three role experiences without logging out.
// The selection lives in AppShell's adminView state (see App.jsx) so the
// header's "Switch view" control can reset it too -- not persisted anywhere,
// so a refresh always comes back here.
function AdminMenu({ onSelect }) {
  return (
    <div className="page">
      <h1>Select View</h1>
      <div className="type-grid">
        {ADMIN_VIEWS.map((v) => (
          <button key={v.key} type="button" className="type-card" onClick={() => onSelect(v.key)}>
            <strong>{v.label}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

// Post-login home screen, branched by the logged-in user's role. qc gets the
// original inspection-type picker unchanged; operator and engineer get their
// role-specific screens. admin gets AdminMenu, which renders one of the same
// three screens (unchanged) based on adminView, passed down from AppShell.
export default function Home({ adminView, setAdminView }) {
  const { user } = useAuth();

  if (user?.role === "admin") {
    if (adminView === "qc") return <QcHome />;
    if (adminView === "operator") return <OperatorHome />;
    if (adminView === "engineer") return <EngineerHome />;
    return <AdminMenu onSelect={setAdminView} />;
  }

  if (user?.role === "operator") return <OperatorHome />;
  if (user?.role === "engineer") return <EngineerHome />;
  return <QcHome />;
}
