import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

export default function InspectionCapture() {
  const { inspectionId } = useParams();
  const [inspection, setInspection] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [values, setValues] = useState({}); // balloon_point_id -> value
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const insp = await api.getInspection(inspectionId);
      setInspection(insp);

      const drawingData = insp.drawing_id ? await api.getDrawing(insp.drawing_id) : null;
      setDrawing(drawingData);

      const initial = {};
      const measurementsByPoint = Object.fromEntries(insp.measurements.map((m) => [m.balloon_point_id, m]));
      (drawingData?.points || []).forEach((p) => {
        initial[p.id] = measurementsByPoint[p.id]?.measured_value ?? "";
      });
      setValues(initial);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(load, [inspectionId]);

  const handleChange = (pointId, value) => {
    setValues((prev) => ({ ...prev, [pointId]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const measurements = Object.entries(values)
        .filter(([, v]) => v !== "")
        .map(([balloon_point_id, measured_value]) => ({
          balloon_point_id: Number(balloon_point_id),
          measured_value: Number(measured_value),
        }));
      await api.saveMeasurements(inspectionId, measurements);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (status) => {
    try {
      await api.setStatus(inspectionId, status);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!inspection || !drawing) {
    return (
      <div className="page">
        {error && <p className="error">{error}</p>}
        <p>Loading...</p>
      </div>
    );
  }

  const measurementsByPoint = Object.fromEntries(inspection.measurements.map((m) => [m.balloon_point_id, m]));

  return (
    <div className="page">
      <Link to={`/parts/${inspection.part_id}/inspections`} className="back-link">
        ← Inspections
      </Link>
      <h1>Inspection Sheet — Final Inspection</h1>
      <p className="muted">
        Inspection #{inspection.id} · Status: <span className={`status status-${inspection.status}`}>{inspection.status}</span>
      </p>

      {error && <p className="error">{error}</p>}

      <table className="capture-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th>Nominal</th>
            <th>Tolerance</th>
            <th>Measured value</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {drawing.points.map((p) => {
            const measurement = measurementsByPoint[p.id];
            const within = measurement?.within_tolerance;
            return (
              <tr key={p.id}>
                <td>{p.balloon_number}</td>
                <td>{p.description}</td>
                <td>{p.nominal_value ?? "—"}</td>
                <td>{p.nominal_value != null ? `± ${p.tolerance_minus ?? 0} / ${p.tolerance_plus ?? 0}` : "—"}</td>
                <td>
                  <input
                    type="number"
                    step="any"
                    value={values[p.id] ?? ""}
                    onChange={(e) => handleChange(p.id, e.target.value)}
                  />
                </td>
                <td>
                  {within === 1 && <span className="result ok">OK</span>}
                  {within === 0 && <span className="result fail">OUT</span>}
                  {(within === null || within === undefined) && <span className="muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="actions-row">
        <button onClick={handleSave} disabled={saving}>
          Save measurements
        </button>
        <button onClick={() => handleStatus("approved")} className="approve">
          Approve
        </button>
        <button onClick={() => handleStatus("rejected")} className="reject">
          Reject
        </button>
        <Link to={`/inspections/${inspectionId}/sheet`} className="secondary-link">
          View / Print Inspection Sheet
        </Link>
      </div>
    </div>
  );
}
