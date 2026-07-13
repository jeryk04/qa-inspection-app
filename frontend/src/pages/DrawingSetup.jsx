import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/api$/, "");

export default function DrawingSetup() {
  const { piezaId } = useParams();
  const [drawing, setDrawing] = useState(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);

  const [numero, setNumero] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [nominal, setNominal] = useState("");
  const [tolMenos, setTolMenos] = useState("");
  const [tolMas, setTolMas] = useState("");

  const load = async () => {
    try {
      const drawings = await api.getDrawings(piezaId);
      if (drawings.length > 0) {
        const full = await api.getDrawing(drawings[0].id);
        setDrawing(full);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(load, [piezaId]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    const formData = new FormData();
    formData.append("pieza_id", piezaId);
    formData.append("imagen", file);
    try {
      await api.uploadDrawing(formData);
      setFile(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleAddPunto = async (e) => {
    e.preventDefault();
    if (!numero || !drawing) return;
    try {
      await api.addPunto(drawing.id, {
        numero_balloon: Number(numero),
        descripcion,
        valor_nominal: nominal ? Number(nominal) : null,
        tolerancia_menos: tolMenos ? Number(tolMenos) : null,
        tolerancia_mas: tolMas ? Number(tolMas) : null,
      });
      setNumero("");
      setDescripcion("");
      setNominal("");
      setTolMenos("");
      setTolMas("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <Link to={`/piezas/${piezaId}/inspecciones`} className="back-link">
        ← Inspecciones
      </Link>
      <h1>Balloon Drawing — Pieza #{piezaId}</h1>
      {error && <p className="error">{error}</p>}

      {!drawing && (
        <form className="inline-form" onSubmit={handleUpload}>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0])} />
          <button type="submit">Subir drawing</button>
        </form>
      )}

      {drawing && (
        <>
          <img
            src={`${API_ORIGIN}${drawing.imagen_path}`}
            alt="Balloon drawing"
            className="drawing-preview"
          />

          <h2>Puntos numerados ({drawing.puntos.length})</h2>
          <form className="punto-form" onSubmit={handleAddPunto}>
            <input placeholder="# balloon" type="number" value={numero} onChange={(e) => setNumero(e.target.value)} />
            <input placeholder="Descripción" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
            <input placeholder="Nominal" type="number" step="any" value={nominal} onChange={(e) => setNominal(e.target.value)} />
            <input placeholder="Tol. -" type="number" step="any" value={tolMenos} onChange={(e) => setTolMenos(e.target.value)} />
            <input placeholder="Tol. +" type="number" step="any" value={tolMas} onChange={(e) => setTolMas(e.target.value)} />
            <button type="submit">+ Agregar punto</button>
          </form>

          <table className="puntos-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Descripción</th>
                <th>Nominal</th>
                <th>Tolerancia</th>
              </tr>
            </thead>
            <tbody>
              {drawing.puntos.map((p) => (
                <tr key={p.id}>
                  <td>{p.numero_balloon}</td>
                  <td>{p.descripcion}</td>
                  <td>{p.valor_nominal ?? "—"}</td>
                  <td>
                    {p.valor_nominal != null ? `± ${p.tolerancia_menos ?? 0} / ${p.tolerancia_mas ?? 0} ${p.unidad}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
