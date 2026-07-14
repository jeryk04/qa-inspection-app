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

  const points = drawing?.points ?? [];
  const samples = [...new Set(inspection.measurements.map((m) => m.sample_number))].sort((a, b) => a - b);
  const grid = Object.fromEntries(
    inspection.measurements.map((m) => [`${m.balloon_point_id}:${m.sample_number}`, m])
  );

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
          <h1>Final Inspection Data Sheet</h1>
          <table className="sheet-meta">
            <tbody>
              <tr>
                <td>
                  <strong>Part #:</strong> {inspection.part_number}
                </td>
                <td>
                  <strong>Heat:</strong> {inspection.heat || "—"}
                </td>
                <td>
                  <strong>Quantity:</strong> {inspection.quantity ?? "—"}
                </td>
                <td>
                  <strong>Supplier:</strong> {inspection.supplier || "—"}
                </td>
                <td>
                  <strong>PO#:</strong> {inspection.po_number || "—"}
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Operation:</strong> {inspection.operation || "—"}
                </td>
                <td>
                  <strong>Job#:</strong> {inspection.job_number || "—"}
                </td>
                <td>
                  <strong>Customer:</strong> {inspection.customer || inspection.client_name}
                </td>
                <td colSpan={2}>
                  <strong>Customer PO#:</strong> {inspection.customer_po_number || "—"}
                </td>
              </tr>
              <tr>
                <td>
                  <strong>N:</strong> {inspection.sampling_plan_n ?? "—"}
                </td>
                <td>
                  <strong>C:</strong> {inspection.sampling_plan_c ?? "—"}
                </td>
                <td>
                  <strong>Lot Disposition:</strong> {inspection.lot_disposition || "—"}
                </td>
                <td>
                  <strong>By:</strong> {inspection.inspector || "—"}
                </td>
                <td>
                  <strong>Date:</strong> {inspection.date}
                </td>
              </tr>
              <tr>
                <td colSpan={5}>
                  <strong>Result:</strong>{" "}
                  <span className={`status status-${inspection.status}`}>{inspection.status}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </header>

        <div className="table-scroll">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Find #</th>
                {points.map((p) => (
                  <th key={p.id}>{p.balloon_number}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Max. Spec.</td>
                {points.map((p) => (
                  <td key={p.id}>{p.max_spec != null ? `${p.max_spec}${p.unit || ""}` : "—"}</td>
                ))}
              </tr>
              <tr>
                <td>MEAN</td>
                {points.map((p) => (
                  <td key={p.id}>{p.mean_value != null ? `${p.mean_value}${p.unit || ""}` : "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Min. Spec.</td>
                {points.map((p) => (
                  <td key={p.id}>{p.min_spec != null ? `${p.min_spec}${p.unit || ""}` : "—"}</td>
                ))}
              </tr>
              {samples.map((s) => (
                <tr key={s}>
                  <td>{Number.isInteger(s) ? s : s.toFixed(1)}</td>
                  {points.map((p) => {
                    const cell = grid[`${p.id}:${s}`];
                    const within = cell?.within_tolerance;
                    return (
                      <td key={p.id} className={within === 0 ? "sheet-cell-fail" : ""}>
                        {cell?.measured_value ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
