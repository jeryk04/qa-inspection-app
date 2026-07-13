import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";

export default function Inspecciones() {
  const { piezaId } = useParams();
  const navigate = useNavigate();
  const [inspecciones, setInspecciones] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(false);

  const load = () => {
    api.getInspecciones({ pieza_id: piezaId }).then(setInspecciones).catch((e) => setError(e.message));
    api.getDrawings(piezaId).then(setDrawings).catch((e) => setError(e.message));
  };

  useEffect(load, [piezaId]);

  const crearInspeccion = async () => {
    if (drawings.length === 0) {
      setError("Esta pieza no tiene un Balloon Drawing configurado todavía. Configúralo primero.");
      return;
    }
    setCreando(true);
    try {
      const drawing = drawings[0]; // usa el más reciente (fase 1: una sola versión activa)
      const inspeccion = await api.createInspeccion({
        pieza_id: Number(piezaId),
        drawing_id: drawing.id,
        tipo: "final",
      });
      navigate(`/inspecciones/${inspeccion.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreando(false);
    }
  };

  return (
    <div className="page">
      <Link to={`/clientes`} className="back-link">
        ← Clientes
      </Link>
      <h1>Inspecciones — Pieza #{piezaId}</h1>

      <div className="actions-row">
        <button onClick={crearInspeccion} disabled={creando}>
          + Nueva Final Inspection
        </button>
        <Link to={`/piezas/${piezaId}/drawing`} className="secondary-link">
          Configurar Balloon Drawing
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <ul className="card-list">
        {inspecciones.map((i) => (
          <li key={i.id} className="card">
            <Link to={`/inspecciones/${i.id}`}>
              <strong>{i.tipo}</strong>
              <span className="muted"> · {i.fecha} · </span>
              <span className={`estado estado-${i.estado}`}>{i.estado}</span>
            </Link>
          </li>
        ))}
        {inspecciones.length === 0 && <p className="muted">Todavía no hay inspecciones para esta pieza.</p>}
      </ul>
    </div>
  );
}
