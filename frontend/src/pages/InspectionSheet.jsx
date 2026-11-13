import { Fragment, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { formatSpec } from "../lib/numeric";
import { api, downloadInspectionPdf, downloadInspectionXlsx, inspectionPdfName } from "../api/client";
import { resultStatus, resultLabel, formatDate, showsQuantity } from "../lib/format";
import { isSpecless, summarizeCheckPoint } from "../lib/passfail";
import logo from "../assets/logo.png";


// Only the types actually reachable from the UI (plus 'samples', which has
// no paper-form checkbox of its own -- see schema.sql's inspections.type
// comment -- but still gets a chip here like every other type). 'quote' and
// 'other' are real schema values but aren't reachable from the UI, so they
// never get a chip.
const TYPE_LABELS = [
  ["incoming", "Incoming"],
  ["setup", "Set Up"],
  ["in_process", "In Process"],
  ["final", "Final"],
  ["samples", "Samples"],
];

const TYPE_TITLES = {
  quote: "Quote Inspection Data Sheet",
  incoming: "Incoming Inspection Data Sheet",
  setup: "Set-up Inspection Data Sheet",
  in_process: "In-Process Inspection Data Sheet",
  final: "Final Inspection Data Sheet",
  other: "Inspection Data Sheet",
  samples: "Samples Inspection Data Sheet",
};

const COMPANY = {
  name: "G & J STEEL & TUBING, INC.",
  tagline: "Quality Parts, On Time",
  address: "301 Roycefield Rd., Hillsborough, NJ 08844",
  tel: "1-800-322-8823",
  fax: "860-434-1371",
};

// Mirrors backend/src/pdf/inspectionSheet.js's withPlannedSamples -- rows
// 1..sampling_plan_n show even before anything's been measured, so a
// freshly-planned, still-empty sheet can be viewed/printed blank and filled
// in on paper first.
function withPlannedSamples(measuredSamples, inspection) {
  // Machine log mode: n= is a piece count (the sum of each row's Qty), and
  // each row is one log entry -- padding to n would add hundreds of blanks.
  if (inspection.machine_log_mode) return measuredSamples;
  const target = Math.floor(Number(inspection.sampling_plan_n));
  if (!Number.isFinite(target) || target <= 0) return measuredSamples;
  const set = new Set(measuredSamples);
  for (let i = 1; i <= target; i++) set.add(i);
  return [...set].sort((a, b) => a - b);
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
// in below it, one per Operator operation (see linkedInProcesses in
// getInspectionDetail).
function DataSheetReport({ inspection }) {
  const points = inspection.points ?? [];
  const result = resultStatus(inspection);
  // A machine-log row can carry only a Qty/Machine #/Comment and no reading.
  const samples = [
    ...new Set([
      ...inspection.measurements.map((m) => m.sample_number),
      ...(inspection.machine_log_mode ? (inspection.sampleRows || []).map((r) => r.sample_number) : []),
    ]),
  ].sort((a, b) => a - b);
  const grid = Object.fromEntries(
    inspection.measurements.map((m) => [`${m.balloon_point_id}:${m.sample_number}`, m])
  );
  const signature = inspection.signature;
  // machine_log_mode's per-row Qty/Machine #/Comment (see schema.sql) --
  // frozen on the inspection at creation, same as hundred_percent_inspection.
  const machineLogMode = !!inspection.machine_log_mode;
  const sampleRowsByNumber = Object.fromEntries(
    (inspection.sampleRows || []).map((r) => [r.sample_number, r])
  );

  // A specless (check) column reports as a qty-inspected/qty-rejected
  // summary instead of one row per piece only when (a) it has an explicit
  // point-summary (hundred_percent_inspection mode -- possibly with zero
  // measurements rows to fall back on), (b) the 100% Inspection flag is set,
  // or (c) there are more than a handful of rows and the sheet is either an
  // implied 100% inspection (the sampling plan covers the whole quantity) or
  // nothing but check columns. A short implied-100% sheet -- e.g. a 5-piece
  // FAI with n=5 -- keeps its per-sample OKs in the grid, same as capture
  // showed them, rather than collapsing 5 rows into a tally.
  const SUMMARIZE_THRESHOLD = 10;
  const hasExplicitSummary = (p) => (inspection.pointSummaries || []).some((s) => s.balloon_point_id === p.id);
  const planN = Number(inspection.sampling_plan_n);
  const qty = Number(inspection.quantity);
  const impliedHundredPercent = qty > 0 && planN >= qty;
  const onlyCheckColumns = points.length > 0 && points.every(isSpecless);
  // A machine log keeps every row (each has its own Qty/Machine #/Comment) --
  // only an explicit 100% Inspection flag turns its checks into a tally.
  const summarizeChecks = inspection.machine_log_mode
    ? !!inspection.hundred_percent_inspection
    : !!inspection.hundred_percent_inspection ||
      ((impliedHundredPercent || onlyCheckColumns) && samples.length > SUMMARIZE_THRESHOLD);
  const summaryPoints = points.filter((p) => isSpecless(p) && (hasExplicitSummary(p) || summarizeChecks));
  const gridPoints = points.filter((p) => !summaryPoints.includes(p));
  const hasAnySpec = gridPoints.some((p) => p.max_spec != null || p.min_spec != null || p.mean_value != null);
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
  //
  // But when there ARE no specless columns narrowing things down, show the
  // full planned row count (sampling_plan_n) even before anything's been
  // measured -- a sample row otherwise only exists once a value's been typed
  // into it (see InspectionCapture.jsx's saveMeasurementsNow), so a
  // freshly-planned, still-empty sheet would otherwise print/view as zero
  // rows instead of blank ones ready to fill in on paper.
  const gridSamples =
    summaryPoints.length === 0
      ? withPlannedSamples(samples, inspection)
      : [
          ...new Set(
            inspection.measurements
              .filter((m) => gridPoints.some((p) => p.id === m.balloon_point_id))
              .map((m) => m.sample_number)
          ),
        ].sort((a, b) => a - b);

  // The header card's fields in reading order: who/what first (row 1), then
  // the inspection's own numbers and sign-off (row 2) -- always exactly two
  // rows on one shared column grid, so every label lines up under the one
  // above it whatever the field count. Mirrors backend/src/pdf/
  // inspectionSheet.js's getMetaFields.
  const operationName = inspection.operation_name || inspection.operation;
  const metaFields = [
    ["Part #", inspection.part_number],
    ["Rev", inspection.drawing_rev || "N/A"],
    // Incoming Inspection's paper header tracks material FROM a supplier by
    // their PO#/heat, not a customer/shop Job#-WO# -- same fields
    // InspectionCapture.jsx's INCOMING_HEADER_FIELDS captures.
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
    // Set-up / In-Process sheets are scoped to one operation on the part
    // (e.g. "Bending") -- name it so the sheet says which step.
    ...(operationName ? [["Operation", operationName]] : []),
    ...(showsQuantity(inspection) ? [["Quantity", inspection.quantity ?? "—"]] : []),
    ["Sampling Plan", inspection.sampling_plan_n ?? "—"],
    ["Total Rejected", inspection.sampling_plan_c ?? "—"],
    ["By", inspection.inspector || "—"],
    ["Date", formatDate(inspection.date)],
  ];

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

      <div className="report-meta-card">
        <div className="report-meta-grid" style={{ "--meta-cols": Math.ceil(metaFields.length / 2) }}>
          {metaFields.map(([label, value]) => (
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
        </div>
        {/* Result gets its own panel on the right, divided off and centered,
            so it reads as the sheet's verdict rather than one more field. */}
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
                {machineLogMode && (
                  <>
                    <th>Qty</th>
                    <th>Machine #</th>
                  </>
                )}
                {gridPoints.map((p) => (
                  <th key={p.id}>{p.balloon_number}</th>
                ))}
                {machineLogMode && <th>Comment</th>}
              </tr>
            </thead>
            <tbody>
              {/* Same as InspectionCapture.jsx's hasAnySpec: no spec on any column
                  (e.g. a Go/No-Go/Visual machine log) skips three empty rows. */}
              {hasAnySpec && (
                <>
                  <tr className="sheet-spec-row">
                    <td>Max. Spec.</td>
                    {machineLogMode && (
                      <>
                        <td></td>
                        <td></td>
                      </>
                    )}
                    {gridPoints.map((p) => (
                      <td key={p.id}>{formatSpec(p.max_spec, p) ?? "—"}</td>
                    ))}
                    {machineLogMode && <td></td>}
                  </tr>
                  <tr className="sheet-spec-row">
                    <td>MEAN</td>
                    {machineLogMode && (
                      <>
                        <td></td>
                        <td></td>
                      </>
                    )}
                    {gridPoints.map((p) => (
                      <td key={p.id}>{formatSpec(p.mean_value, p) ?? "—"}</td>
                    ))}
                    {machineLogMode && <td></td>}
                  </tr>
                  <tr className="sheet-spec-row sheet-spec-row-last">
                    <td>Min. Spec.</td>
                    {machineLogMode && (
                      <>
                        <td></td>
                        <td></td>
                      </>
                    )}
                    {gridPoints.map((p) => (
                      <td key={p.id}>{formatSpec(p.min_spec, p) ?? "—"}</td>
                    ))}
                    {machineLogMode && <td></td>}
                  </tr>
                </>
              )}
              {gridSamples.map((s, i) => (
                <tr key={s} className={i % 2 === 1 ? "sheet-row-alt" : ""}>
                  <td>{Number.isInteger(s) ? s : s.toFixed(1)}</td>
                  {machineLogMode && (
                    <>
                      <td>{sampleRowsByNumber[s]?.qty ?? ""}</td>
                      <td>{sampleRowsByNumber[s]?.machine_number || ""}</td>
                    </>
                  )}
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
                          : ""}
                      </td>
                    );
                  })}
                  {machineLogMode && <td>{sampleRowsByNumber[s]?.comment || ""}</td>}
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
          {/* The inspection date from the header, not the signing moment --
              the exact e-signature timestamp stays in the sheet's History
              (signatures table / audit log), never restated as another date. */}
          {signature ? (
            <div className="signature-value">{formatDate(inspection.date)}</div>
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
  // Carries the Data Sheet's returnTo (see InspectionCapture) through
  // "Back to capture", so its back arrow still returns to the dashboard etc.
  const location = useLocation();
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

  const linkedSheets = inspection.linkedInProcesses ?? [];

  return (
    <div className="page sheet-page">
      <div className="no-print actions-row">
        <Link to={`/inspections/${inspectionId}`} state={location.state} className="back-link">
          ← Back to capture
        </Link>
        <button
          onClick={() =>
            downloadInspectionPdf(inspectionId, inspectionPdfName(inspection)).catch((e) => setError(e.message))
          }
        >
          Download PDF
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() =>
            downloadInspectionXlsx(inspectionId, inspectionPdfName(inspection)).catch((e) => setError(e.message))
          }
        >
          Download Excel
        </button>
        <button type="button" className="secondary-btn" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <DataSheetReport inspection={inspection} />

      {linkedSheets.map((linked) => (
        <Fragment key={linked.id}>
          <div className="sheet-linked-divider">
            <span>
              Operator In-Process Data Sheet
              {linked.operation_name ? ` — ${linked.operation_name}` : ""}
              {linked.job_number ? ` — WO# ${linked.job_number}` : ""}
            </span>
          </div>
          <DataSheetReport inspection={linked} />
        </Fragment>
      ))}
    </div>
  );
}
