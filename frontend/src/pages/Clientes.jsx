import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export default function Clientes() {
  const [clientes, setClientes] = useState([]);
  const [nombre, setNombre] = useState("");
  const [contacto, setContacto] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .getClientes()
      .then(setClientes)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) return;
    try {
      await api.createCliente({ nombre, contacto });
      setNombre("");
      setContacto("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <h1>Clientes</h1>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          placeholder="Nombre del cliente"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
        <input
          placeholder="Contacto (opcional)"
          value={contacto}
          onChange={(e) => setContacto(e.target.value)}
        />
        <button type="submit">Agregar cliente</button>
      </form>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>Cargando...</p>
      ) : (
        <ul className="card-list">
          {clientes.map((c) => (
            <li key={c.id} className="card">
              <Link to={`/clientes/${c.id}/piezas`}>
                <strong>{c.nombre}</strong>
                {c.contacto && <span className="muted"> · {c.contacto}</span>}
              </Link>
            </li>
          ))}
          {clientes.length === 0 && <p className="muted">Todavía no hay clientes.</p>}
        </ul>
      )}
    </div>
  );
}
