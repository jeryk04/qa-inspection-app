import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

export default function InspectionSheet() {
  const { inspectionId } = useParams();
  const [inspection, setInspection] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const insp = await api.getInspection(inspectionId);
        setInspection(insp);
        if (insp.drawing_id) setDrawing(await api.getDrawing(insp.drawing_id));
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [inspectionId]);

  if (error) return <p className="error">{error}</p>;
  if (!inspection) return <p>Loading...</p>;

  const measurementsByPoint = Object.fromEntries(inspection.measurements.map((m) => [m.balloon_point_id, m]));
  const points = drawing?.points ?? inspection.measurements;

  return (
    <div className="page sheet-page">
      <div className="no-print actions-row">
        <Link to={`/inspections/${inspectionId}`} className="back-link">
          ← Back to capture
        </Link>
        <button onClick={() => window.print()}>Print / Export PDF</button>
      </div>

      <div className="sheet">
        <header className="sheet-header">
          <h1>Final Inspection Report</h1>
          <table className="sheet-meta">
            <tbody>
              <tr>
                <td>
                  <strong>Client:</strong> {inspection.client_name}
                </td>
                <td>
                  <strong>Part number:</strong> {inspection.part_number}
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Description:</strong> {inspection.part_description || "—"}
                </td>
                <td>
                  <strong>Inspection #:</strong> {inspection.id}
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Inspector:</strong> {inspection.inspector || "—"}
                </td>
                <td>
                  <strong>Date:</strong> {inspection.date}
                </td>
              </tr>
              <tr>
                <td colSpan={2}>
                  <strong>Result:</strong>{" "}
                  <span className={`status status-${inspection.status}`}>{inspection.status}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </header>

        <table className="sheet-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th>Nominal</th>
              <th>Tolerance</th>
              <th>Measured</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => {
              const measurement = measurementsByPoint[p.id] ?? p;
              const within = measurement?.within_tolerance;
              return (
                <tr key={p.id ?? p.balloon_point_id}>
                  <td>{p.balloon_number}</td>
                  <td>{p.description}</td>
                  <td>{p.nominal_value ?? "—"}</td>
                  <td>{p.nominal_value != null ? `± ${p.tolerance_minus ?? 0} / ${p.tolerance_plus ?? 0} ${p.unit ?? ""}` : "—"}</td>
                  <td>{measurement?.measured_value ?? "—"}</td>
                  <td>
                    {within === 1 && <span className="result ok">OK</span>}
                    {within === 0 && <span className="result fail">OUT</span>}
                    {(within === null || within === undefined) && "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {inspection.notes && (
          <p>
            <strong>Notes:</strong> {inspection.notes}
          </p>
        )}

        <div className="sheet-signature">
          <div>
            <div className="signature-line" />
            <span className="muted">Inspector signature</span>
          </div>
          <div>
            <div className="signature-line" />
            <span className="muted">Date</span>
          </div>
        </div>
      </div>
    </div>
  );
}
