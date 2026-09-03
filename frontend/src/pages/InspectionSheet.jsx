import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { resultStatus, resultLabel } from "../lib/format";
import { isSpecless, summarizeCheckPoint } from "../lib/passfail";
import logo from "../assets/logo.png";

// Same fallback pattern as api/client.js -- not exported from there, so
// repeated locally (matches InspectionCapture.jsx/DataSheetTemplate.jsx).
const BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001/api`;

// Matches the schema's `type` enum — Phase 1 only ever creates 'final'.
const TYPE_LABELS = [
  ["quote", "Quote"],
  ["incoming", "Incoming"],
  ["setup", "1st Article"],
  ["in_process", "In Process"],
  ["final", "Final"],
  ["other", "Other"],
];

const TYPE_TITLES = {
  quote: "Quote Inspection Data Sheet",
  incoming: "Incoming Inspection Data Sheet",
  setup: "Set-up Inspection Data Sheet",
  in_process: "In-Process Inspection Data Sheet",
  final: "Final Inspection Data Sheet",
  other: "Inspection Data Sheet",
};

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

// One Data Sheet's full report body (header/meta/tables/notes/signature) --
// used both for the sheet being viewed and, when it's a Final Inspection
// that required one, the companion Operator In-Process Data Sheet bundled
// in below it (see linkedInProcess in getInspectionDetail).
function DataSheetReport({ inspection }) {
  const points = inspection.points ?? [];
  const result = resultStatus(inspection);
  const samples = [...new Set(inspection.measurements.map((m) => m.sample_number))].sort((a, b) => a - b);
  const grid = Object.fromEntries(
    inspection.measurements.map((m) => [`${m.balloon_point_id}:${m.sample_number}`, m])
  );
  const signature = inspection.signature;

  // A specless (check) column reports as a qty-inspected/qty-rejected
  // summary instead of one row per piece when either (a) it has an explicit
  // point-summary (hundred_percent_inspection mode -- possibly with zero
  // measurements rows to fall back on) or (b) it has more than a handful of
  // real per-sample rows (the older "Fill + Mark OK" path). A small sample
  // count still lists every row, same as a numeric column always does.
  const SUMMARIZE_THRESHOLD = 10;
  const hasExplicitSummary = (p) => (inspection.pointSummaries || []).some((s) => s.balloon_point_id === p.id);
  const summaryPoints = points.filter(
    (p) => isSpecless(p) && (hasExplicitSummary(p) || samples.length > SUMMARIZE_THRESHOLD)
  );
  const gridPoints = points.filter((p) => !summaryPoints.includes(p));
  const summaryRows = summaryPoints.map((point) => ({ point, ...summarizeCheckPoint(point, inspection) }));
  // The Reject Notes column is just a wall of "—" on a sheet where
  // everything passed -- only worth a column when at least one row actually
  // has something to say.
  const hasAnyReject = summaryRows.some((r) => r.qtyRejected > 0);
  // A numeric column (e.g. a Surface Roughness spot-check) can need far
  // fewer actual readings than the specless columns that drove `samples` up
  // to 100+ in the first place (e.g. one spot-check per lot, not one per
  // piece) -- rendering the full sample range here would print/show mostly
  // "—" rows. Re-derive the row list from only the measurements that
  // actually belong to a still-gridded (numeric) column.
  const gridSamples = [
    ...new Set(
      inspection.measurements
        .filter((m) => gridPoints.some((p) => p.id === m.balloon_point_id))
        .map((m) => m.sample_number)
    ),
  ].sort((a, b) => a - b);

  return (
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
          <h1>{TYPE_TITLES[inspection.type] ?? "Inspection Data Sheet"}</h1>
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
        {[
          ["Part #", inspection.part_number],
          ["Quantity", inspection.quantity ?? "—"],
          // Incoming Inspection's paper header tracks material FROM a
          // supplier by their PO#/heat, not a customer/shop Job#-WO# --
          // same fields InspectionCapture.jsx's INCOMING_HEADER_FIELDS
          // captures, just laid out for print here.
          ...(inspection.type === "incoming"
            ? [
                ["Supplier", inspection.supplier || "—"],
                ["PO#", inspection.po_number || "—"],
                ["Heat #", inspection.heat || "—"],
              ]
            : [
                ["Customer", inspection.customer || inspection.client_name],
                ["Job# / WO#", inspection.job_number || "—"],
              ]),
          ["Sampling Plan N", inspection.sampling_plan_n ?? "—"],
          ["Sampling Plan C", inspection.sampling_plan_c ?? "—"],
          ["By", inspection.inspector || "—"],
          ["Date", inspection.date ? inspection.date.slice(0, 10) : "—"],
        ].map(([label, value]) => (
          <div className="report-meta-item" key={label}>
            <span className="report-meta-label">{label}</span>
            <span className="report-meta-value">{value}</span>
          </div>
        ))}

        {result === "conditionally_approved" && (
          <div className="report-meta-item report-meta-wide">
            <span className="report-meta-label">Reason</span>
            <span className="report-meta-value">{inspection.conditional_reason}</span>
          </div>
        )}
        <div className="report-meta-item report-meta-result">
          <span className="report-meta-label">Result</span>
          <span className={`result-badge result-badge-${result}`}>
            {(result === "approved" || result === "conditionally_approved") && <CheckIcon />}
            {result === "rejected" && <XIcon />}
            {resultLabel(result)}
          </span>
        </div>
      </div>

      {summaryRows.length > 0 && (
        <div className="table-scroll">
          <table className="sheet-table sheet-summary-table">
            <thead>
              <tr>
                <th>Find #</th>
                <th>Qty Inspected</th>
                <th>Qty Rejected</th>
                {hasAnyReject && <th>Reject Notes</th>}
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(({ point, qtyInspected, qtyRejected, rejectNotes }) => {
                const rejected = qtyRejected > 0;
                return (
                  <tr key={point.id}>
                    <td>{point.balloon_number}</td>
                    <td>{qtyInspected}</td>
                    <td>{qtyRejected}</td>
                    {hasAnyReject && <td>{rejectNotes || "—"}</td>}
                    <td>
                      <span className={`result-badge result-badge-${rejected ? "rejected" : "approved"}`}>
                        {rejected ? <XIcon /> : <CheckIcon />}
                        {rejected ? `${qtyRejected} Rejected` : "Approved"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {gridPoints.length > 0 && (
        <div className="table-scroll">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Find #</th>
                {gridPoints.map((p) => (
                  <th key={p.id}>{p.balloon_number}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="sheet-spec-row">
                <td>Max. Spec.</td>
                {gridPoints.map((p) => (
                  <td key={p.id}>{p.max_spec != null ? p.max_spec.toFixed(p.decimal_places ?? 3) : "—"}</td>
                ))}
              </tr>
              <tr className="sheet-spec-row">
                <td>MEAN</td>
                {gridPoints.map((p) => (
                  <td key={p.id}>{p.mean_value != null ? p.mean_value.toFixed(p.decimal_places ?? 3) : "—"}</td>
                ))}
              </tr>
              <tr className="sheet-spec-row sheet-spec-row-last">
                <td>Min. Spec.</td>
                {gridPoints.map((p) => (
                  <td key={p.id}>{p.min_spec != null ? p.min_spec.toFixed(p.decimal_places ?? 3) : "—"}</td>
                ))}
              </tr>
              {gridSamples.map((s, i) => (
                <tr key={s} className={i % 2 === 1 ? "sheet-row-alt" : ""}>
                  <td>{Number.isInteger(s) ? s : s.toFixed(1)}</td>
                  {gridPoints.map((p) => {
                    const cell = grid[`${p.id}:${s}`];
                    const within = cell?.within_tolerance;
                    const fail = within === 0;
                    return (
                      <td key={p.id} className={fail ? "sheet-cell-fail" : ""}>
                        {fail && <WarningIcon />}
                        {cell?.measured_value != null
                          ? typeof cell.measured_value === "number"
                            ? cell.measured_value.toFixed(p.decimal_places ?? 3)
                            : cell.measured_value
                          : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
  );
}

export default function InspectionSheet() {
  const { inspectionId } = useParams();
  const [inspection, setInspection] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getInspection(inspectionId)
      .then(setInspection)
      .catch((e) => setError(e.message));
  }, [inspectionId]);

  if (error) return <p className="error">{error}</p>;
  if (!inspection) return <p>Loading...</p>;

  const linked = inspection.linkedInProcess;

  return (
    <div className="page sheet-page">
      <div className="no-print actions-row">
        <Link to={`/inspections/${inspectionId}`} className="back-link">
          ← Back to capture
        </Link>
        <button onClick={() => window.open(`${BASE_URL}/inspections/${inspectionId}/pdf`, "_blank")}>
          Print / Export PDF
        </button>
      </div>

      <DataSheetReport inspection={inspection} />

      {linked && (
        <>
          <div className="sheet-linked-divider">
            <span>
              Operator In-Process Data Sheet{linked.job_number ? ` — WO# ${linked.job_number}` : ""}
            </span>
          </div>
          <DataSheetReport inspection={linked} />
        </>
      )}
    </div>
  );
}
