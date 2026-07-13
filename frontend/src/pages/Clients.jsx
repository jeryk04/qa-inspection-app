import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .getClients()
      .then(setClients)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createClient({ name, contact });
      setName("");
      setContact("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <h1>Clients</h1>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          placeholder="Client name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="Contact (optional)"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
        <button type="submit">Add client</button>
      </form>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul className="card-list">
          {clients.map((c) => (
            <li key={c.id} className="card">
              <Link to={`/clients/${c.id}/parts`}>
                <strong>{c.name}</strong>
                {c.contact && <span className="muted"> · {c.contact}</span>}
              </Link>
            </li>
          ))}
          {clients.length === 0 && <p className="muted">No clients yet.</p>}
        </ul>
      )}
    </div>
  );
}
