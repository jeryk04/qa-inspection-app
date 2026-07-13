import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

export default function InspeccionCaptura() {
  const { inspeccionId } = useParams();
  const [inspeccion, setInspeccion] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [valores, setValores] = useState({}); // balloon_punto_id -> valor
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const load = async () => {
    try {
      const insp = await api.getInspeccion(inspeccionId);
      setInspeccion(insp);

      const drawingData = insp.drawing_id ? await api.getDrawing(insp.drawing_id) : null;
      setDrawing(drawingData);

      const initial = {};
      const medicionesPorPunto = Object.fromEntries(insp.mediciones.map((m) => [m.balloon_punto_id, m]));
      (drawingData?.puntos || []).forEach((p) => {
        initial[p.id] = medicionesPorPunto[p.id]?.valor_medido ?? "";
      });
      setValores(initial);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(load, [inspeccionId]);

  const handleChange = (puntoId, value) => {
    setValores((prev) => ({ ...prev, [puntoId]: value }));
  };

  const handleGuardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const mediciones = Object.entries(valores)
        .filter(([, v]) => v !== "")
        .map(([balloon_punto_id, valor_medido]) => ({
          balloon_punto_id: Number(balloon_punto_id),
          valor_medido: Number(valor_medido),
        }));
      await api.saveMediciones(inspeccionId, mediciones);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const handleEstado = async (estado) => {
    try {
      await api.setEstado(inspeccionId, estado);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!inspeccion || !drawing) {
    return (
      <div className="page">
        {error && <p className="error">{error}</p>}
        <p>Cargando...</p>
      </div>
    );
  }

  const medicionesPorPunto = Object.fromEntries(inspeccion.mediciones.map((m) => [m.balloon_punto_id, m]));

  return (
    <div className="page">
      <Link to={`/piezas/${inspeccion.pieza_id}/inspecciones`} className="back-link">
        ← Inspecciones
      </Link>
      <h1>Hoja de Inspección — Final Inspection</h1>
      <p className="muted">
        Inspección #{inspeccion.id} · Estado: <span className={`estado estado-${inspeccion.estado}`}>{inspeccion.estado}</span>
      </p>

      {error && <p className="error">{error}</p>}

      <table className="captura-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Descripción</th>
            <th>Nominal</th>
            <th>Tolerancia</th>
            <th>Valor medido</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {drawing.puntos.map((p) => {
            const medicion = medicionesPorPunto[p.id];
            const dentro = medicion?.dentro_tolerancia;
            return (
              <tr key={p.id}>
                <td>{p.numero_balloon}</td>
                <td>{p.descripcion}</td>
                <td>{p.valor_nominal ?? "—"}</td>
                <td>{p.valor_nominal != null ? `± ${p.tolerancia_menos ?? 0} / ${p.tolerancia_mas ?? 0}` : "—"}</td>
                <td>
                  <input
                    type="number"
                    step="any"
                    value={valores[p.id] ?? ""}
                    onChange={(e) => handleChange(p.id, e.target.value)}
                  />
                </td>
                <td>
                  {dentro === 1 && <span className="resultado ok">OK</span>}
                  {dentro === 0 && <span className="resultado fail">FUERA</span>}
                  {(dentro === null || dentro === undefined) && <span className="muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="actions-row">
        <button onClick={handleGuardar} disabled={guardando}>
          Guardar mediciones
        </button>
        <button onClick={() => handleEstado("aprobada")} className="approve">
          Aprobar
        </button>
        <button onClick={() => handleEstado("rechazada")} className="reject">
          Rechazar
        </button>
      </div>
    </div>
  );
}
