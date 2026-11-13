import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import PageNav from "../components/PageNav";
import Tabs from "../components/Tabs";
import { INCOMING_CATEGORY_CLIENTS, INCOMING_CATEGORY_LABELS } from "../lib/incoming";

const CATEGORIES = ["subcomponent", "subcontractor"];
const TABS = [
  { key: "all", label: "All" },
  ...CATEGORIES.map((c) => ({ key: c, label: INCOMING_CATEGORY_LABELS[c] })),
];

// Browse Suppliers: the Subcomponent and Subcontractor folders from
// Incoming Inspection (lib/incoming.js) -- Incoming Material is left out,
// it's a list of material numbers, not suppliers -- browsed the same way as
// Browse Customers. View only over the existing folders: a folder named
// after a customer (e.g. Siemens) is that same customer record, so its
// parts list is the customer's whole list. Each supplier shows how many of
// its parts have the Incoming template and a drawing.
export default function Suppliers() {
  const [clients, setClients] = useState([]);
  const [summary, setSummary] = useState({});
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getClients()
      .then((all) => {
        const names = new Set(CATEGORIES.flatMap((c) => INCOMING_CATEGORY_CLIENTS[c]));
        const suppliers = all.filter((c) => names.has(c.name));
        setClients(suppliers);
        if (suppliers.length) return api.getSetupSummary(suppliers.map((c) => c.id)).then(setSummary);
      })
      .catch((e) => setError(e.message));
  }, []);

  const categoryOf = (name) => CATEGORIES.find((c) => INCOMING_CATEGORY_CLIENTS[c].includes(name));
  const trimmedQuery = query.trim().toLowerCase();
  const visible = clients
    .filter((c) => tab === "all" || categoryOf(c.name) === tab)
    .filter((c) => !trimmedQuery || c.name.toLowerCase().includes(trimmedQuery))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="page">
      <PageNav backTo="/" backLabel="Back to Home" items={[{ label: "Home", to: "/" }, { label: "Suppliers" }]} />
      <h1>Suppliers</h1>
      <p className="muted">
        Subcomponent and Subcontractor suppliers from Incoming Inspection. Click one to see its parts, their Incoming
        templates and drawings.
      </p>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="search-bar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          placeholder="Search suppliers..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <p className="error">{error}</p>}
      <ul className="card-list">
        {visible.map((c) => {
          const s = summary[c.id];
          return (
            <li key={c.id} className="card">
              <Link to={`/clients/${c.id}/parts?browse=1&supplier=1`} className="supplier-card-link">
                <span>
                  <strong>{c.name}</strong>
                  <span className="supplier-category muted"> · {INCOMING_CATEGORY_LABELS[categoryOf(c.name)]}</span>
                </span>
                {s && (
                  <span className="supplier-counts muted">
                    {s.parts} part{s.parts === 1 ? "" : "s"}
                    {s.parts > 0 && (
                      <>
                        {" · "}
                        <span className={s.templates === s.parts ? "supplier-count-ok" : undefined}>
                          {s.templates} with template
                        </span>
                        {" · "}
                        <span className={s.drawings === s.parts ? "supplier-count-ok" : undefined}>
                          {s.drawings} with drawing
                        </span>
                      </>
                    )}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
        {clients.length > 0 && visible.length === 0 && (
          <p className="muted">{trimmedQuery ? `No suppliers match "${query.trim()}".` : "No suppliers here."}</p>
        )}
      </ul>
    </div>
  );
}
