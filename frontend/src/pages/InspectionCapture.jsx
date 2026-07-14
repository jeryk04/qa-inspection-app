import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

// Only the header fields Final Inspection actually uses. Heat/Supplier/PO#/
// Customer PO#/Operation are on the paper form for other inspection types
// (Incoming, etc.) — the columns still exist in the data model for when
// those phases are built, this capture form just doesn't ask for them.
const HEADER_FIELDS = [
  ["customer", "Customer"],
  ["quantity", "Quantity"],
  ["job_number", "Job#"],
  ["inspector", "Inspector"],
  ["sampling_plan_n", "N:"],
  ["sampling_plan_c", "C:"],
  ["lot_disposition", "Lot Disposition"],
];

const ACTION_LABELS = {
  created: "Created",
  header_updated: "Header updated",
  measurements_saved: "Measurements saved",
  status_changed: "Status changed",
  signed_approved: "Signed — Approved",
  signed_rejected: "Signed — Rejected",
};

function cellKey(pointId, sampleNumber) {
  return `${pointId}:${sampleNumber}`;
}

export default function InspectionCapture() {
  const { inspectionId } = useParams();
  const { user } = useAuth();
  const [inspection, setInspection] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [header, setHeader] = useState({});
  const [samples, setSamples] = useState([1]);
  const [values, setValues] = useState({});
  const [auditLog, setAuditLog] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingHeader, setSavingHeader] = useState(false);
  const [signingAction, setSigningAction] = useState(null); // null | "approved" | "rejected"
  const [signerName, setSignerName] = useState("");
  const [signing, setSigning] = useState(false);

  const load = async () => {
    try {
      const insp = await api.getInspection(inspectionId);
      setInspection(insp);

      const drawingData = insp.drawing_id ? await api.getDrawing(insp.drawing_id) : null;
      setDrawing(drawingData);

      const headerState = {};
      HEADER_FIELDS.forEach(([field]) => {
        headerState[field] = insp[field] ?? "";
      });
      setHeader(headerState);

      const sampleNumbers = [...new Set(insp.measurements.map((m) => m.sample_number))].sort((a, b) => a - b);
      setSamples(sampleNumbers.length > 0 ? sampleNumbers : [1]);

      const initial = {};
      insp.measurements.forEach((m) => {
        initial[cellKey(m.balloon_point_id, m.sample_number)] = m.measured_value ?? "";
      });
      setValues(initial);

      api.getAuditLog(inspectionId).then(setAuditLog).catch(() => {});
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, [inspectionId]);

  const handleHeaderChange = (field, value) => {
    setHeader((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveHeader = async () => {
    setSavingHeader(true);
    setError(null);
    try {
      await api.updateInspection(inspectionId, header);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingHeader(false);
    }
  };

  const handleAddSample = () => {
    const next = samples.length > 0 ? Math.max(...samples) + 1 : 1;
    setSamples([...samples, next]);
  };

  const handleChange = (pointId, sampleNumber, value) => {
    setValues((prev) => ({ ...prev, [cellKey(pointId, sampleNumber)]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const measurements = [];
      (drawing?.points || []).forEach((p) => {
        samples.forEach((s) => {
          const raw = values[cellKey(p.id, s)];
          if (raw !== "" && raw !== undefined) {
            measurements.push({ balloon_point_id: p.id, sample_number: s, measured_value: Number(raw) });
          }
        });
      });
      await api.saveMeasurements(inspectionId, measurements);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const startSigning = (action) => {
    setSigningAction(action);
    setSignerName(user?.full_name ?? "");
  };

  const cancelSigning = () => {
    setSigningAction(null);
    setSignerName("");
  };

  const confirmSigning = async () => {
    setSigning(true);
    setError(null);
    try {
      await api.setStatus(inspectionId, signingAction, signerName);
      setSigningAction(null);
      setSignerName("");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSigning(false);
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

  const isLocked = inspection.status !== "in_progress";
  const measurementsByCell = Object.fromEntries(
    inspection.measurements.map((m) => [cellKey(m.balloon_point_id, m.sample_number), m])
  );

  return (
    <div className="page">
      <Link to={`/parts/${inspection.part_id}/inspections`} className="back-link">
        ← Data Sheets
      </Link>
      <h1>Data Sheet — {inspection.part_number}</h1>
      <p className="muted">
        Inspection #{inspection.id} · Status: <span className={`status status-${inspection.status}`}>{inspection.status}</span>
      </p>

      {error && <p className="error">{error}</p>}

      {isLocked && (
        <p className="sign-panel">
          This Data Sheet has been signed and is now locked — it can no longer be edited. Use "Export PDF" or
          "View / Print" below to see the final record.
        </p>
      )}

      <h2>Header</h2>
      <div className="header-grid">
        {HEADER_FIELDS.map(([field, label]) => (
          <label key={field} className="header-field">
            <span className="muted">{label}</span>
            {isLocked ? (
              <span className="locked-value">{header[field] || "—"}</span>
            ) : (
              <input value={header[field] ?? ""} onChange={(e) => handleHeaderChange(field, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      {!isLocked && (
        <div className="actions-row">
          <button onClick={handleSaveHeader} disabled={savingHeader} className="secondary-btn">
            Save header
          </button>
        </div>
      )}

      <h2>Measurements</h2>
      <div className="table-scroll">
        <table className="capture-table capture-table-transposed">
          <thead>
            <tr>
              <th>Find #</th>
              {drawing.points.map((p) => (
                <th key={p.id}>{p.balloon_number}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="spec-row">
              <td>Max. Spec.</td>
              {drawing.points.map((p) => (
                <td key={p.id}>{p.max_spec != null ? `${p.max_spec}${p.unit || ""}` : "—"}</td>
              ))}
            </tr>
            <tr className="spec-row">
              <td>MEAN</td>
              {drawing.points.map((p) => (
                <td key={p.id}>{p.mean_value != null ? `${p.mean_value}${p.unit || ""}` : "—"}</td>
              ))}
            </tr>
            <tr className="spec-row">
              <td>Min. Spec.</td>
              {drawing.points.map((p) => (
                <td key={p.id}>{p.min_spec != null ? `${p.min_spec}${p.unit || ""}` : "—"}</td>
              ))}
            </tr>
            {samples.map((s) => (
              <tr key={s}>
                <td>{Number.isInteger(s) ? s : s.toFixed(1)}</td>
                {drawing.points.map((p) => {
                  const measurement = measurementsByCell[cellKey(p.id, s)];
                  const within = measurement?.within_tolerance;
                  const value = values[cellKey(p.id, s)] ?? "";
                  return (
                    <td key={p.id}>
                      {isLocked ? (
                        <span className={within === 0 ? "locked-value-fail" : "locked-value"}>{value || "—"}</span>
                      ) : (
                        <input
                          type="number"
                          step="any"
                          value={value}
                          onChange={(e) => handleChange(p.id, s, e.target.value)}
                          className={within === 0 ? "input-out-of-tolerance" : ""}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="actions-row">
        {!isLocked && (
          <>
            <button onClick={handleAddSample} className="secondary-btn">
              + Add sample
            </button>
            <button onClick={handleSave} disabled={saving}>
              Save measurements
            </button>
            <button onClick={() => startSigning("approved")} className="approve">
              Approve
            </button>
            <button onClick={() => startSigning("rejected")} className="reject">
              Reject
            </button>
          </>
        )}
        <Link to={`/inspections/${inspectionId}/sheet`} className="secondary-link">
          View / Print Inspection Sheet
        </Link>
        <a href={`${BASE_URL}/inspections/${inspectionId}/pdf`} target="_blank" rel="noreferrer" className="secondary-link">
          Export PDF
        </a>
      </div>

      {signingAction && (
        <div className="sign-panel">
          <p>
            Signing as <strong>{user?.full_name}</strong> to <strong>{signingAction}</strong> this inspection.
            Type your full name to confirm:
          </p>
          <div className="actions-row">
            <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Full name" />
            <button onClick={confirmSigning} disabled={signing} className="approve">
              Confirm &amp; Sign
            </button>
            <button onClick={cancelSigning} className="secondary-btn">
              Cancel
            </button>
          </div>
        </div>
      )}

      <h2>History</h2>
      <ul className="audit-log">
        {auditLog.map((entry) => (
          <li key={`${entry.action}-${entry.id}-${entry.at}`}>
            <span className="muted">{entry.at}</span> — <strong>{ACTION_LABELS[entry.action] ?? entry.action}</strong>
            {entry.user_name && <> by {entry.user_name}</>}
          </li>
        ))}
        {auditLog.length === 0 && <li className="muted">No history yet.</li>}
      </ul>
    </div>
  );
}
