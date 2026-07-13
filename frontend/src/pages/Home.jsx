import { Link } from "react-router-dom";

const INSPECTION_TYPES = [
  { key: "final", label: "Final Inspection", enabled: true, to: "/clients" },
  { key: "in_process", label: "In-Process Inspection", enabled: false },
  { key: "setup", label: "Set-up Inspection", enabled: false },
  { key: "incoming", label: "Incoming Inspection", enabled: false },
];

export default function Home() {
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
