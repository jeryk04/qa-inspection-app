import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/api$/, "");

function isPdf(path) {
  return path?.toLowerCase().endsWith(".pdf");
}

export default function DrawingSetup() {
  const { partId } = useParams();
  const [part, setPart] = useState(null);
  const [drawings, setDrawings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [number, setNumber] = useState("");
  const [description, setDescription] = useState("");
  const [maxSpec, setMaxSpec] = useState("");
  const [minSpec, setMinSpec] = useState("");
  const [meanValue, setMeanValue] = useState("");
  const [unit, setUnit] = useState("");

  const loadList = async () => {
    try {
      const list = await api.getDrawings(partId);
      setDrawings(list);
      setSelectedId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    loadList();
    api.getPart(partId).then(setPart).catch((e) => setError(e.message));
  }, [partId]);

  useEffect(() => {
    if (!selectedId) {
      setDrawing(null);
      return;
    }
    api
      .getDrawing(selectedId)
      .then(setDrawing)
      .catch((e) => setError(e.message));
  }, [selectedId]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("part_id", partId);
    formData.append("image", file);
    try {
      const created = await api.uploadDrawing(formData);
      setFile(null);
      await loadList();
      setSelectedId(created.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this drawing revision? This can't be undone.")) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteDrawing(id);
      setSelectedId(null);
      await loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const resetPointForm = () => {
    setEditingId(null);
    setNumber("");
    setDescription("");
    setMaxSpec("");
    setMinSpec("");
    setMeanValue("");
    setUnit("");
  };

  const handleEditPoint = (p) => {
    setEditingId(p.id);
    setNumber(String(p.balloon_number));
    setDescription(p.description || "");
    setMaxSpec(p.max_spec ?? "");
    setMinSpec(p.min_spec ?? "");
    setMeanValue(p.mean_value ?? "");
    setUnit(p.unit || "");
  };

  const handleDeletePoint = async (id) => {
    if (!window.confirm("Delete this point?")) return;
    try {
      await api.deletePoint(id);
      if (editingId === id) resetPointForm();
      const refreshed = await api.getDrawing(drawing.id);
      setDrawing(refreshed);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSubmitPoint = async (e) => {
    e.preventDefault();
    if (!number || !drawing) return;
    const payload = {
      balloon_number: Number(number),
      description,
      max_spec: maxSpec ? Number(maxSpec) : null,
      min_spec: minSpec ? Number(minSpec) : null,
      mean_value: meanValue ? Number(meanValue) : null,
      unit: unit || null,
    };
    try {
      if (editingId) {
        await api.updatePoint(editingId, payload);
      } else {
        await api.addPoint(drawing.id, payload);
      }
      resetPointForm();
      const refreshed = await api.getDrawing(drawing.id);
      setDrawing(refreshed);
    } catch (e) {
      setError(e.message);
    }
  };

  const fileUrl = drawing ? `${API_ORIGIN}${drawing.image_path}` : null;

  return (
    <div className="page">
      <Link to={`/parts/${partId}/inspections`} className="back-link">
        ← Inspections
      </Link>
      <h1>Drawing — {part?.part_number ?? `Part #${partId}`}</h1>
      {error && <p className="error">{error}</p>}

      <form className="inline-form" onSubmit={handleUpload}>
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFile(e.target.files[0])}
        />
        <button type="submit" disabled={uploading}>
          {drawings.length === 0 ? "Upload drawing" : "Upload new revision"}
        </button>
      </form>

      {drawings.length > 0 && (
        <div className="version-pills">
          {drawings.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`version-pill${d.id === selectedId ? " version-pill-active" : ""}`}
              onClick={() => setSelectedId(d.id)}
            >
              v{d.version}
              {d.id === drawings[0].id && " (latest)"}
            </button>
          ))}
        </div>
      )}

      {drawing && (
        <>
          <div className="actions-row">
            <a href={fileUrl} target="_blank" rel="noreferrer" className="secondary-link open-full-size">
              Open full size {isPdf(drawing.image_path) ? "(PDF)" : ""}
            </a>
            <button onClick={() => handleDelete(drawing.id)} disabled={deleting} className="reject">
              Delete this revision
            </button>
          </div>

          {isPdf(drawing.image_path) ? (
            <>
              <p className="muted">
                Inline preview below may not render in every viewer (e.g. VS Code's Simple Browser). If it looks
                blank or shows an error, use "Open full size" above — it opens the PDF directly, which every real
                browser tab renders natively.
              </p>
              <embed src={fileUrl} type="application/pdf" className="drawing-preview drawing-preview-pdf" />
            </>
          ) : (
            <img src={fileUrl} alt="Balloon drawing" className="drawing-preview" />
          )}

          <h2>Numbered points — Find # ({drawing.points.length})</h2>
          <form className="point-form" onSubmit={handleSubmitPoint}>
            <input placeholder="Find #" type="number" value={number} onChange={(e) => setNumber(e.target.value)} />
            <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <input placeholder="Max Spec" type="number" step="any" value={maxSpec} onChange={(e) => setMaxSpec(e.target.value)} />
            <input placeholder="Mean" type="number" step="any" value={meanValue} onChange={(e) => setMeanValue(e.target.value)} />
            <input placeholder="Min Spec" type="number" step="any" value={minSpec} onChange={(e) => setMinSpec(e.target.value)} />
            <input placeholder="Unit (e.g. °, optional)" value={unit} onChange={(e) => setUnit(e.target.value)} className="unit-input" />
            <button type="submit">{editingId ? "Save point" : "+ Add point"}</button>
            {editingId && (
              <button type="button" className="secondary-btn" onClick={resetPointForm}>
                Cancel
              </button>
            )}
          </form>

          <table className="points-table">
            <thead>
              <tr>
                <th>Find #</th>
                <th>Description</th>
                <th>Max Spec</th>
                <th>Mean</th>
                <th>Min Spec</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drawing.points.map((p) => (
                <tr key={p.id} className={p.id === editingId ? "row-editing" : ""}>
                  <td>{p.balloon_number}</td>
                  <td>{p.description}</td>
                  <td>{p.max_spec != null ? `${p.max_spec}${p.unit || ""}` : "—"}</td>
                  <td>{p.mean_value != null ? `${p.mean_value}${p.unit || ""}` : "—"}</td>
                  <td>{p.min_spec != null ? `${p.min_spec}${p.unit || ""}` : "—"}</td>
                  <td className="row-actions">
                    <button type="button" className="secondary-btn" onClick={() => handleEditPoint(p)}>
                      Edit
                    </button>
                    <button type="button" className="reject" onClick={() => handleDeletePoint(p.id)}>
                      Delete
                    </button>
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
