import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

export default function Parts() {
  const { clientId } = useParams();
  const [parts, setParts] = useState([]);
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState(null);

  const load = () => {
    api.getParts(clientId).then(setParts).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [clientId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!partNumber.trim()) return;
    try {
      await api.createPart({ client_id: Number(clientId), part_number: partNumber, description });
      setPartNumber("");
      setDescription("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <Link to="/clients" className="back-link">
        ← Customers
      </Link>
      <h1>Parts</h1>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          placeholder="Part number"
          value={partNumber}
          onChange={(e) => setPartNumber(e.target.value)}
        />
        <input
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button type="submit">Add part</button>
      </form>

      {error && <p className="error">{error}</p>}
      <ul className="card-list">
        {parts.map((p) => (
          <li key={p.id} className="card">
            <Link to={`/parts/${p.id}/inspections`}>
              <strong>{p.part_number}</strong>
              {p.description && <span className="muted"> · {p.description}</span>}
            </Link>
          </li>
        ))}
        {parts.length === 0 && <p className="muted">This customer has no parts yet.</p>}
      </ul>
    </div>
  );
}
