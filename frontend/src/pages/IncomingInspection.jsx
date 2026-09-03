import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { INCOMING_MATERIAL_CLIENT_NAME } from "../lib/incoming";

// The Home.jsx entry point for Incoming Inspection: 3 categories, matching
// the 3 real source folders (see lib/incoming.js). Incoming Material has
// exactly one client/bucket, so it links straight to its Parts page instead
// of opening a sub-list with a single entry; Subcomponent and Subcontractor
// each fan out into many folders, handled by IncomingFolders.jsx.
export default function IncomingInspection() {
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  const materialClient = clients.find((c) => c.name === INCOMING_MATERIAL_CLIENT_NAME);

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Home
      </Link>
      <h1>Incoming Inspection</h1>
      {error && <p className="error">{error}</p>}
      <div className="type-grid">
        {materialClient ? (
          <Link to={`/clients/${materialClient.id}/parts?type=incoming`} className="type-card">
            <strong>Incoming Material</strong>
          </Link>
        ) : (
          <div className="type-card type-card-disabled">
            <strong>Incoming Material</strong>
          </div>
        )}
        <Link to="/incoming/subcomponent" className="type-card">
          <strong>Subcomponent</strong>
        </Link>
        <Link to="/incoming/subcontractor" className="type-card">
          <strong>Subcontractor</strong>
        </Link>
      </div>
    </div>
  );
}
