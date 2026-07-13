import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

export default function Piezas() {
  const { clienteId } = useParams();
  const [piezas, setPiezas] = useState([]);
  const [numeroParte, setNumeroParte] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState(null);

  const load = () => {
    api.getPiezas(clienteId).then(setPiezas).catch((e) => setError(e.message));
  };

  useEffect(load, [clienteId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!numeroParte.trim()) return;
    try {
      await api.createPieza({ cliente_id: Number(clienteId), numero_parte: numeroParte, descripcion });
      setNumeroParte("");
      setDescripcion("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <Link to="/clientes" className="back-link">
        ← Clientes
      </Link>
      <h1>Piezas</h1>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          placeholder="Número de parte"
          value={numeroParte}
          onChange={(e) => setNumeroParte(e.target.value)}
        />
        <input
          placeholder="Descripción (opcional)"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
        <button type="submit">Agregar pieza</button>
      </form>

      {error && <p className="error">{error}</p>}
      <ul className="card-list">
        {piezas.map((p) => (
          <li key={p.id} className="card">
            <Link to={`/piezas/${p.id}/inspecciones`}>
              <strong>{p.numero_parte}</strong>
              {p.descripcion && <span className="muted"> · {p.descripcion}</span>}
            </Link>
          </li>
        ))}
        {piezas.length === 0 && <p className="muted">Este cliente todavía no tiene piezas.</p>}
      </ul>
    </div>
  );
}
