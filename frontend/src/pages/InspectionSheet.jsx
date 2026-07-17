import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import logo from "../assets/logo.png";

// Matches the schema's `type` enum — Phase 1 only ever creates 'final'.
const TYPE_LABELS = [
  ["quote", "Quote"],
  ["incoming", "Incoming"],
  ["setup", "1st Article"],
  ["in_process", "In Process"],
  ["final", "Final"],
  ["other", "Other"],
];

const COMPANY = {
  name: "G & J STEEL & TUBING, INC.",
  tagline: "Quality Parts, On Time",
  address: "301 Roycefield Rd., Hillsborough, NJ 08844",
  tel: "1-800-322-8823",
  fax: "860-434-1371",
};

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="warning-icon">
      <path
        d="M10 2.5l8.5 14.7a1 1 0 01-.87 1.5H2.37a1 1 0 01-.87-1.5L10 2.5z"
        fill="currentColor"
      />
      <path d="M10 8v4" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="14.3" r="0.9" fill="white" />
    </svg>
  );
}

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
  const signature = inspection.signature;

  return (
    <div className="page sheet-page">
      <div className="no-print actions-row">
        <Link to={`/inspections/${inspectionId}`} className="back-link">
          ← Back to capture
        </Link>
        <button onClick={() => window.print()}>Print / Export PDF</button>
      </div>

      <div className="sheet">
        <header className="report-header">
          <div className="report-logo-box">
            <img src={logo} alt="" className="report-logo" />
          </div>
          <div className="report-company-info">
            <div className="report-company-name">{COMPANY.name}</div>
            <div className="report-company-tagline">{COMPANY.tagline}</div>
            <div className="report-company-detail">{COMPANY.address}</div>
            <div className="report-company-detail">
              Tel: {COMPANY.tel} &nbsp;·&nbsp; Fax: {COMPANY.fax}
            </div>
          </div>
          <div className="report-title-block">
            <h1>Final Inspection Data Sheet</h1>
            <div className="type-indicator">
              {TYPE_LABELS.map(([key, label]) => (
                <span key={key} className={`type-chip${inspection.type === key ? " type-chip-active" : ""}`}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </header>

        <div className="report-meta-grid">
          <div className="report-meta-item">
            <span className="report-meta-label">Part #</span>
            <span className="report-meta-value">{inspection.part_number}</span>
          </div>
          <div className="report-meta-item">
            <span className="report-meta-label">Quantity</span>
            <span className="report-meta-value">{inspection.quantity ?? "—"}</span>
          </div>
          <div className="report-meta-item">
            <span className="report-meta-label">Customer</span>
            <span className="report-meta-value">{inspection.customer || inspection.client_name}</span>
          </div>
          <div className="report-meta-item">
            <span className="report-meta-label">Job# / WO#</span>
            <span className="report-meta-value">{inspection.job_number || "—"}</span>
          </div>

          <div className="report-meta-item">
            <span className="report-meta-label">Sampling Plan N</span>
            <span className="report-meta-value">{inspection.sampling_plan_n ?? "—"}</span>
          </div>
          <div className="report-meta-item">
            <span className="report-meta-label">Sampling Plan C</span>
            <span className="report-meta-value">{inspection.sampling_plan_c ?? "—"}</span>
          </div>
          <div className="report-meta-item">
            <span className="report-meta-label">By</span>
            <span className="report-meta-value">{inspection.inspector || "—"}</span>
          </div>
          <div className="report-meta-item">
            <span className="report-meta-label">Date</span>
            <span className="report-meta-value">{inspection.date ? inspection.date.slice(0, 10) : "—"}</span>
          </div>

          <div className="report-meta-item report-meta-wide">
            <span className="report-meta-label">Lot Disposition</span>
            <span className="report-meta-value">{inspection.lot_disposition || "—"}</span>
          </div>
          <div className="report-meta-item report-meta-result">
            <span className="report-meta-label">Result</span>
            <span className={`result-badge result-badge-${inspection.status}`}>
              {inspection.status === "approved" && <CheckIcon />}
              {inspection.status === "rejected" && <XIcon />}
              {inspection.status}
            </span>
          </div>
        </div>

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
              <tr className="sheet-spec-row">
                <td>Max. Spec.</td>
                {points.map((p) => (
                  <td key={p.id}>{p.max_spec != null ? p.max_spec.toFixed(p.decimal_places ?? 3) : "—"}</td>
                ))}
              </tr>
              <tr className="sheet-spec-row">
                <td>MEAN</td>
                {points.map((p) => (
                  <td key={p.id}>{p.mean_value != null ? p.mean_value.toFixed(p.decimal_places ?? 3) : "—"}</td>
                ))}
              </tr>
              <tr className="sheet-spec-row sheet-spec-row-last">
                <td>Min. Spec.</td>
                {points.map((p) => (
                  <td key={p.id}>{p.min_spec != null ? p.min_spec.toFixed(p.decimal_places ?? 3) : "—"}</td>
                ))}
              </tr>
              {samples.map((s, i) => (
                <tr key={s} className={i % 2 === 1 ? "sheet-row-alt" : ""}>
                  <td>{Number.isInteger(s) ? s : s.toFixed(1)}</td>
                  {points.map((p) => {
                    const cell = grid[`${p.id}:${s}`];
                    const within = cell?.within_tolerance;
                    const fail = within === 0;
                    return (
                      <td key={p.id} className={fail ? "sheet-cell-fail" : ""}>
                        {fail && <WarningIcon />}
                        {cell?.measured_value != null ? cell.measured_value.toFixed(p.decimal_places ?? 3) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {inspection.notes && (
          <p className="report-notes">
            <strong>Notes:</strong> {inspection.notes}
          </p>
        )}

        <div className="sheet-signature">
          <div>
            {signature ? (
              <div className="signature-script">{signature.full_name}</div>
            ) : (
              <div className="signature-line" />
            )}
            <span className="muted">
              Inspector signature{signature ? " · electronically signed" : ""}
            </span>
          </div>
          <div>
            {signature ? (
              <div className="signature-value">{formatDateTime(signature.signed_at)}</div>
            ) : (
              <div className="signature-line" />
            )}
            <span className="muted">Date</span>
          </div>
        </div>
      </div>
    </div>
  );
}
