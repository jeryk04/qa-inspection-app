import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/api$/, "");

export default function DrawingSetup() {
  const { partId } = useParams();
  const [drawing, setDrawing] = useState(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);

  const [number, setNumber] = useState("");
  const [description, setDescription] = useState("");
  const [maxSpec, setMaxSpec] = useState("");
  const [minSpec, setMinSpec] = useState("");
  const [meanValue, setMeanValue] = useState("");

  const load = async () => {
    try {
      const drawings = await api.getDrawings(partId);
      if (drawings.length > 0) {
        const full = await api.getDrawing(drawings[0].id);
        setDrawing(full);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, [partId]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    const formData = new FormData();
    formData.append("part_id", partId);
    formData.append("image", file);
    try {
      await api.uploadDrawing(formData);
      setFile(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleAddPoint = async (e) => {
    e.preventDefault();
    if (!number || !drawing) return;
    try {
      await api.addPoint(drawing.id, {
        balloon_number: Number(number),
        description,
        max_spec: maxSpec ? Number(maxSpec) : null,
        min_spec: minSpec ? Number(minSpec) : null,
        mean_value: meanValue ? Number(meanValue) : null,
      });
      setNumber("");
      setDescription("");
      setMaxSpec("");
      setMinSpec("");
      setMeanValue("");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <Link to={`/parts/${partId}/inspections`} className="back-link">
        ← Inspections
      </Link>
      <h1>Balloon Drawing — Part #{partId}</h1>
      {error && <p className="error">{error}</p>}

      {!drawing && (
        <form className="inline-form" onSubmit={handleUpload}>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0])} />
          <button type="submit">Upload drawing</button>
        </form>
      )}

      {drawing && (
        <>
          <img
            src={`${API_ORIGIN}${drawing.image_path}`}
            alt="Balloon drawing"
            className="drawing-preview"
          />

          <h2>Numbered points — Find # ({drawing.points.length})</h2>
          <form className="point-form" onSubmit={handleAddPoint}>
            <input placeholder="Find #" type="number" value={number} onChange={(e) => setNumber(e.target.value)} />
            <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <input placeholder="Max Spec" type="number" step="any" value={maxSpec} onChange={(e) => setMaxSpec(e.target.value)} />
            <input placeholder="Mean" type="number" step="any" value={meanValue} onChange={(e) => setMeanValue(e.target.value)} />
            <input placeholder="Min Spec" type="number" step="any" value={minSpec} onChange={(e) => setMinSpec(e.target.value)} />
            <button type="submit">+ Add point</button>
          </form>

          <table className="points-table">
            <thead>
              <tr>
                <th>Find #</th>
                <th>Description</th>
                <th>Max Spec</th>
                <th>Mean</th>
                <th>Min Spec</th>
              </tr>
            </thead>
            <tbody>
              {drawing.points.map((p) => (
                <tr key={p.id}>
                  <td>{p.balloon_number}</td>
                  <td>{p.description}</td>
                  <td>{p.max_spec ?? "—"}</td>
                  <td>{p.mean_value ?? "—"}</td>
                  <td>{p.min_spec ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
