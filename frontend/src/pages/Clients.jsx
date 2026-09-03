import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../hooks/useConfirm";
import { INCOMING_ONLY_PARTS, INCOMING_ONLY_CLIENT_NAMES } from "../lib/incoming";
import PageNav from "../components/PageNav";

const MAX_RESULTS = 30;

// Operators' In-Process work only ever covers these customers (see the
// matching OPERATOR_ALLOWED_CLIENTS guard on POST /api/inspections) -- this
// is the picker-side half, so they never see the other ~110 customers to
// begin with instead of being blocked only after picking one.
const OPERATOR_ALLOWED_CLIENT_NAMES = new Set([
  "Gas Tubes",
  "Insulet Corp",
  "PMI",
  "Shaw Development",
  "Environment One",
  "Kawasaki",
  "Bravo",
  "Game Scout",
  "Noveske Rifleworks LLC",
]);

export default function Clients() {
  const { effectiveRole } = useAuth();
  const isOperator = effectiveRole === "operator";
  const [searchParams] = useSearchParams();
  // Carries a non-default inspection type (e.g. "in_process", from the
  // operator home screen) through to the Parts page. Absent for the normal
  // QC path, which keeps this link exactly as it was before.
  const type = searchParams.get("type");
  const [clients, setClients] = useState([]);
  const [allParts, setAllParts] = useState([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [contextMenu, setContextMenu] = useState(null); // { clientId, x, y }
  const [confirm, confirmDialog] = useConfirm();
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const skipBlurSaveRef = useRef(false);

  const load = () => {
    setLoading(true);
    api
      .getClients()
      .then(setClients)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.getAllParts().then(setAllParts).catch(() => {});
  }, []);

  const clientNameById = useMemo(() => {
    const map = new Map();
    clients.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [clients]);

  // A client that exists purely as an Incoming Inspection categorization
  // bucket (see INCOMING_ONLY_CLIENT_NAMES) has nothing real to inspect via
  // Final/Set-up/In-Process -- this page is never reached from the actual
  // /incoming flow (that goes straight from IncomingFolders.jsx to
  // Parts.jsx), so it's safe to filter these out unconditionally here. A
  // "double duty" client like Kawasaki or TRB, which has real manufacturing
  // parts too, is untouched.
  const incomingOnlyClientIds = useMemo(() => {
    const ids = new Set();
    clients.forEach((c) => {
      if (INCOMING_ONLY_CLIENT_NAMES.has(c.name)) ids.add(c.id);
    });
    return ids;
  }, [clients]);

  const visibleClients = useMemo(() => {
    let result = clients.filter((c) => !incomingOnlyClientIds.has(c.id));
    if (isOperator) result = result.filter((c) => OPERATOR_ALLOWED_CLIENT_NAMES.has(c.name));
    return result;
  }, [clients, isOperator, incomingOnlyClientIds]);
  const visibleClientIds = useMemo(() => new Set(visibleClients.map((c) => c.id)), [visibleClients]);

  // Parts land on the same next screen Parts.jsx sends them to: in_process
  // and setup go to the per-part Operations list, everything else to the
  // Data Sheet.
  const partHref = (id) => {
    if (type === "in_process" || type === "setup") return `/parts/${id}/operations?type=${type}`;
    return type ? `/parts/${id}/inspections?type=${type}` : `/parts/${id}/inspections`;
  };

  const trimmedQuery = query.trim().toLowerCase();
  const matchedClients = useMemo(() => {
    if (!trimmedQuery) return [];
    return visibleClients.filter((c) => c.name.toLowerCase().includes(trimmedQuery));
  }, [visibleClients, trimmedQuery]);
  const matchedParts = useMemo(() => {
    if (!trimmedQuery) return [];
    // visibleClientIds already excludes pure-Incoming-only clients (and,
    // for an operator, applies their customer allowlist too) -- applied
    // for everyone now, not just operators, so a QC search for a raw
    // material or subcomponent part number doesn't surface a client that
    // isn't even shown in the list above.
    return allParts
      .filter((p) => visibleClientIds.has(p.client_id))
      .filter((p) => !INCOMING_ONLY_PARTS.has(`${clientNameById.get(p.client_id)}:${p.part_number}`))
      .filter((p) => p.part_number.toLowerCase().includes(trimmedQuery));
  }, [allParts, trimmedQuery, visibleClientIds, clientNameById]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createClient({ name });
      setName("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleContextMenu = (e, client) => {
    e.preventDefault();
    setContextMenu({ clientId: client.id, x: e.clientX, y: e.clientY });
  };

  const startRename = (client) => {
    setRenamingId(client.id);
    setRenameValue(client.name);
    setContextMenu(null);
  };

  const submitRename = async (id) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed) return;
    try {
      await api.updateClient(id, { name: trimmed });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const cancelRename = () => {
    skipBlurSaveRef.current = true;
    setRenamingId(null);
  };

  const handleDelete = async (client) => {
    setContextMenu(null);
    if (!(await confirm(`Delete customer "${client.name}"? This can't be undone.`))) return;
    try {
      await api.deleteClient(client.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <PageNav backTo="/" backLabel="Back to Home" items={[{ label: "Home", to: "/" }, { label: "Customers" }]} />
      <h1>Customers</h1>

      <div className="search-bar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          placeholder="Search customers or part #..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!isOperator && (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input
            placeholder="Customer name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit">Add customer</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {trimmedQuery ? (
        <div className="search-results">
          <h2>Customers</h2>
          {matchedClients.length === 0 ? (
            <p className="muted">No matching customers.</p>
          ) : (
            <ul className="card-list">
              {matchedClients.slice(0, MAX_RESULTS).map((c) => (
                <li key={c.id} className="card">
                  <Link to={type ? `/clients/${c.id}/parts?type=${type}` : `/clients/${c.id}/parts`}>
                    <strong>{c.name}</strong>
                  </Link>
                </li>
              ))}
              {matchedClients.length > MAX_RESULTS && (
                <p className="muted">+{matchedClients.length - MAX_RESULTS} more — refine your search.</p>
              )}
            </ul>
          )}

          <h2>Parts</h2>
          {matchedParts.length === 0 ? (
            <p className="muted">No matching parts.</p>
          ) : (
            <ul className="card-list">
              {matchedParts.slice(0, MAX_RESULTS).map((p) => (
                <li key={p.id} className="card">
                  <Link to={partHref(p.id)}>
                    <strong>{p.part_number}</strong>
                    <span className="muted"> · {clientNameById.get(p.client_id) || "Unknown customer"}</span>
                  </Link>
                </li>
              ))}
              {matchedParts.length > MAX_RESULTS && (
                <p className="muted">+{matchedParts.length - MAX_RESULTS} more — refine your search.</p>
              )}
            </ul>
          )}
        </div>
      ) : (
        <>
          {!isOperator && <p className="muted">Right-click a customer to rename or delete it.</p>}
          {loading ? (
            <p>Loading...</p>
          ) : (
            <ul className="card-list">
              {visibleClients.map((c) => (
                <li key={c.id} className="card" onContextMenu={isOperator ? undefined : (e) => handleContextMenu(e, c)}>
                  {renamingId === c.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (skipBlurSaveRef.current) {
                          skipBlurSaveRef.current = false;
                          return;
                        }
                        submitRename(c.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                        if (e.key === "Escape") cancelRename();
                      }}
                    />
                  ) : (
                    <Link to={type ? `/clients/${c.id}/parts?type=${type}` : `/clients/${c.id}/parts`}>
                      <strong>{c.name}</strong>
                    </Link>
                  )}
                </li>
              ))}
              {visibleClients.length === 0 && <p className="muted">No customers yet.</p>}
            </ul>
          )}
        </>
      )}

      {contextMenu && (
        <ul className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <li onClick={() => startRename(clients.find((c) => c.id === contextMenu.clientId))}>Rename</li>
          <li
            className="context-menu-danger"
            onClick={() => handleDelete(clients.find((c) => c.id === contextMenu.clientId))}
          >
            Delete
          </li>
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
