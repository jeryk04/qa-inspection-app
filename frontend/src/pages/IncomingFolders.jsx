import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import PageNav from "../components/PageNav";
import { INCOMING_CATEGORY_CLIENTS, INCOMING_CATEGORY_LABELS } from "../lib/incoming";

// Lists the client "folders" within one Incoming Inspection category
// (Subcomponent or Subcontractor) -- see IncomingInspection.jsx for the
// category picker and lib/incoming.js for the folder-to-category mapping.
export default function IncomingFolders() {
  const { category } = useParams();
  const [clients, setClients] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  const names = INCOMING_CATEGORY_CLIENTS[category] || [];
  const folders = clients
    .filter((c) => names.includes(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const trimmedQuery = query.trim().toLowerCase();
  const visibleFolders = trimmedQuery
    ? folders.filter((c) => c.name.toLowerCase().includes(trimmedQuery))
    : folders;

  return (
    <div className="page">
      <PageNav
        backTo="/incoming"
        backLabel="Back to Incoming Inspection"
        items={[
          { label: "Home", to: "/" },
          { label: "Incoming Inspection", to: "/incoming" },
          { label: INCOMING_CATEGORY_LABELS[category] ?? category },
        ]}
      />
      <h1>{INCOMING_CATEGORY_LABELS[category] ?? category}</h1>

      <div className="search-bar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          placeholder="Search folders..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <p className="error">{error}</p>}
      <ul className="card-list">
        {visibleFolders.map((c) => (
          <li key={c.id} className="card">
            <Link to={`/clients/${c.id}/parts?type=incoming`}>
              <strong>{c.name}</strong>
            </Link>
          </li>
        ))}
        {folders.length === 0 && <p className="muted">No folders yet.</p>}
        {folders.length > 0 && visibleFolders.length === 0 && (
          <p className="muted">No folders match "{query.trim()}".</p>
        )}
      </ul>
    </div>
  );
}
