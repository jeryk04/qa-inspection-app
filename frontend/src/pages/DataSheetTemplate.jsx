import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { handleGridArrowNav } from "../lib/gridNav";
import { toStoredNumber } from "../lib/numeric";
import DecimalCell from "../components/DecimalCell";

const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/api$/, "");

const EMPTY_SPEC = { balloon_number: "", max_spec: "", min_spec: "", mean_value: "", decimal_places: "3" };

function isPdf(path) {
  return path?.toLowerCase().endsWith(".pdf");
}

// The Data Sheet Template: the fixed list of Find# columns (with their
// Max Spec/Mean/Min Spec) tied to one drawing revision of a part. Set up
// once, rarely edited again. Every inspection created for this part reuses
// this template's columns read-only — this page is the only place they can
// be added, edited, or removed.
export default function DataSheetTemplate() {
  const { partId } = useParams();
  const [part, setPart] = useState(null);
  const [drawings, setDrawings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const [specEdits, setSpecEdits] = useState({}); // pointId -> { balloon_number, max_spec, min_spec, mean_value }
  const [newColumns, setNewColumns] = useState([]); // [{ id: <temp negative id> }, ...] — not yet persisted
  const [saving, setSaving] = useState(false);
  const [pointMenu, setPointMenu] = useState(null); // { pointId, x, y }
  const nextTempId = useRef(0);
  // partIds we've already attempted to auto-provision a blank drawing for —
  // guards against React StrictMode's dev-mode double-effect-invocation
  // racing two creates for the same part.
  const provisionedRef = useRef(new Set());

  const loadList = async () => {
    try {
      let list = await api.getDrawings(partId);

      // No revision at all yet — provision a blank one (no image) so the
      // Find# grid is usable immediately instead of requiring an upload first.
      if (list.length === 0 && !provisionedRef.current.has(partId)) {
        provisionedRef.current.add(partId);
        const formData = new FormData();
        formData.append("part_id", partId);
        await api.uploadDrawing(formData);
        list = await api.getDrawings(partId);
      }

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
      .then((d) => {
        setDrawing(d);
        setNewColumns([]);
        const specState = {};
        d.points.forEach((p) => {
          specState[p.id] = {
            balloon_number: p.balloon_number,
            max_spec: p.max_spec ?? "",
            min_spec: p.min_spec ?? "",
            mean_value: p.mean_value ?? "",
            decimal_places: String(p.decimal_places ?? 3),
          };
        });
        setSpecEdits(specState);
      })
      .catch((e) => setError(e.message));
  }, [selectedId]);

  useEffect(() => {
    if (!pointMenu) return;
    const close = () => setPointMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [pointMenu]);

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

  const handleSpecChange = (pointId, field, value) => {
    setSpecEdits((prev) => ({ ...prev, [pointId]: { ...prev[pointId], [field]: value } }));
  };

  const handleAddColumn = () => {
    const tempId = --nextTempId.current;
    setNewColumns((prev) => [...prev, { id: tempId }]);
    setSpecEdits((prev) => ({ ...prev, [tempId]: { ...EMPTY_SPEC } }));
  };

  const handlePointContextMenu = (e, pointId) => {
    e.preventDefault();
    setPointMenu({ pointId, x: e.clientX, y: e.clientY });
  };

  const handleDeletePoint = async (pointId) => {
    setPointMenu(null);
    if (pointId < 0) {
      setNewColumns((prev) => prev.filter((c) => c.id !== pointId));
      setSpecEdits((prev) => {
        const next = { ...prev };
        delete next[pointId];
        return next;
      });
      return;
    }
    if (!window.confirm("Delete this Find# column? This can't be undone.")) return;
    try {
      await api.deletePoint(pointId);
      const refreshed = await api.getDrawing(drawing.id);
      setDrawing(refreshed);
      setSpecEdits((prev) => {
        const next = { ...prev };
        delete next[pointId];
        return next;
      });
    } catch (e) {
      setError(e.message);
    }
  };

  // Single save: creates any draft columns that got a Find# label (blank
  // drafts are dropped), and persists spec/label edits on existing columns.
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const col of newColumns) {
        const edit = specEdits[col.id];
        const label = edit?.balloon_number?.trim();
        if (!label) continue;
        await api.addPoint(drawing.id, {
          balloon_number: label,
          max_spec: toStoredNumber(edit.max_spec),
          min_spec: toStoredNumber(edit.min_spec),
          mean_value: toStoredNumber(edit.mean_value),
          decimal_places: edit.decimal_places,
        });
      }

      await Promise.all(
        drawing.points.map((p) => {
          const edit = specEdits[p.id];
          if (!edit) return null;
          return api.updatePoint(p.id, {
            balloon_number: edit.balloon_number,
            max_spec: toStoredNumber(edit.max_spec),
            min_spec: toStoredNumber(edit.min_spec),
            mean_value: toStoredNumber(edit.mean_value),
            decimal_places: edit.decimal_places,
          });
        })
      );

      setNewColumns([]);
      const refreshed = await api.getDrawing(drawing.id);
      setDrawing(refreshed);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const fileUrl = drawing ? `${API_ORIGIN}${drawing.image_path}` : null;
  const allColumns = drawing ? [...drawing.points, ...newColumns] : [];

  return (
    <div className="page">
      <Link to={`/parts/${partId}/inspections`} className="back-link">
        ← Data Sheets
      </Link>
      <h1>Data Sheet Template — {part?.part_number ?? `Part #${partId}`}</h1>
      <p className="muted">
        Set up once per drawing revision. Every inspection for this part reuses these Find# columns automatically.
      </p>
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
          {drawing.image_path ? (
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
            </>
          ) : (
            <p className="muted">
              No drawing image uploaded yet for this revision — you can still set up Find# columns below, and upload
              an image any time using the form above.
            </p>
          )}

          <h2>Find# Columns ({drawing.points.length})</h2>
          <p className="muted">Right-click a Find# column to delete it.</p>
          <div className="table-scroll">
            <table className="capture-table capture-table-transposed">
              <thead>
                <tr>
                  <th>Find #</th>
                  {allColumns.map((p) => (
                    <th key={p.id} onContextMenu={(e) => handlePointContextMenu(e, p.id)}>
                      <input
                        className="spec-input"
                        value={specEdits[p.id]?.balloon_number ?? ""}
                        onChange={(e) => handleSpecChange(p.id, "balloon_number", e.target.value)}
                        onKeyDown={handleGridArrowNav}
                      />
                    </th>
                  ))}
                  <th className="add-column-cell" onClick={handleAddColumn} title="Add Find#">
                    +
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="spec-row">
                  <td>Max Spec</td>
                  {allColumns.map((p) => (
                    <td key={p.id}>
                      <DecimalCell
                        value={specEdits[p.id]?.max_spec ?? ""}
                        onChange={(v) => handleSpecChange(p.id, "max_spec", v)}
                        decimals={Number(specEdits[p.id]?.decimal_places ?? 3)}
                      />
                    </td>
                  ))}
                </tr>
                <tr className="spec-row">
                  <td>MEAN</td>
                  {allColumns.map((p) => (
                    <td key={p.id}>
                      <DecimalCell
                        value={specEdits[p.id]?.mean_value ?? ""}
                        onChange={(v) => handleSpecChange(p.id, "mean_value", v)}
                        decimals={Number(specEdits[p.id]?.decimal_places ?? 3)}
                      />
                    </td>
                  ))}
                </tr>
                <tr className="spec-row">
                  <td>Min Spec</td>
                  {allColumns.map((p) => (
                    <td key={p.id}>
                      <DecimalCell
                        value={specEdits[p.id]?.min_spec ?? ""}
                        onChange={(v) => handleSpecChange(p.id, "min_spec", v)}
                        decimals={Number(specEdits[p.id]?.decimal_places ?? 3)}
                      />
                    </td>
                  ))}
                </tr>
                <tr className="spec-row">
                  <td>Decimals</td>
                  {allColumns.map((p) => (
                    <td key={p.id}>
                      <input
                        className="spec-input"
                        inputMode="numeric"
                        value={specEdits[p.id]?.decimal_places ?? "3"}
                        onChange={(e) => handleSpecChange(p.id, "decimal_places", e.target.value)}
                        onKeyDown={handleGridArrowNav}
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="actions-row">
            <button onClick={handleSave} disabled={saving}>
              Save Template
            </button>
          </div>
        </>
      )}

      {pointMenu && (
        <ul className="context-menu" style={{ top: pointMenu.y, left: pointMenu.x }}>
          <li className="context-menu-danger" onClick={() => handleDeletePoint(pointMenu.pointId)}>
            Delete
          </li>
        </ul>
      )}
    </div>
  );
}
