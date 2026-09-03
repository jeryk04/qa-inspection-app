const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png");
const PAGE_MARGIN = 30;

// Matches frontend/src/App.css's palette exactly (--primary, --accent,
// --table-header-bg, etc.) -- the PDF is meant to look like the on-screen
// /sheet view now, not the old paper form's dark navy/checkbox styling.
const COLOR = {
  primary: "#1c2029",
  text: "#1c2029",
  textMuted: "#6b7280",
  labelMuted: "#8792a2",
  accent: "#2f6690",
  accentTint: "#e8f0f6",
  border: "#e2e5eb",
  bg: "#f5f6f8",
  tableHeaderBg: "#eef0f3",
  labelColBg: "#eef1f6",
  specFill: "#eaf2fa",
  altFill: "#fafbfc",
  failFill: "#fbeceb",
  fail: "#b3261e",
  okBg: "#e6f4ec",
  ok: "#1a7f4b",
  conditional: "#1d5fa8",
  conditionalBg: "#e7f0fa",
  warn: "#8a5b00",
  warnBg: "#fdf3dd",
};

const RESULT_LABELS = {
  in_progress: "IN PROGRESS",
  approved: "APPROVED",
  conditionally_approved: "CONDITIONALLY APPROVED",
  rejected: "REJECTED",
};

// 'conditionally_approved' isn't a real inspections.status value (see
// PUT /:id/status in routes/inspections.js) -- it's status='approved' with a
// conditional_reason attached, so the PDF/UI-facing result has to be derived.
function getResult(inspection) {
  if (inspection.status === "approved" && inspection.conditional_reason) return "conditionally_approved";
  return inspection.status;
}

// Matches the printed header on the company's paper Data Sheet.
const COMPANY = {
  name: "G & J STEEL & TUBING, INC.",
  tagline: "Quality Parts, On Time",
  addressLine1: "301 Roycefield Rd., Hillsborough, NJ 08844",
  addressLine2: "Tel: 1-800-322-8823    Fax: 860-434-1371",
};

// Matches InspectionSheet.jsx's TYPE_LABELS exactly (order + wording) --
// rendered as a row of pill chips now, not the paper form's checkbox grid.
const TYPE_CHIPS = [
  ["quote", "Quote"],
  ["incoming", "Incoming"],
  ["setup", "1st Article"],
  ["in_process", "In Process"],
  ["final", "Final"],
  ["other", "Other"],
];

const TYPE_TITLES = {
  quote: "QUOTE INSPECTION DATA SHEET",
  incoming: "INCOMING INSPECTION DATA SHEET",
  setup: "SET-UP INSPECTION DATA SHEET",
  in_process: "IN-PROCESS INSPECTION DATA SHEET",
  final: "FINAL INSPECTION DATA SHEET",
  other: "INSPECTION DATA SHEET",
};

// Landscape Letter's own dimensions, in points -- used as fixed constants
// (rather than read off `doc.page` after creation) since every page, on
// every bundled report, is always a full standard sheet -- shrinking a
// short report's page to fit its content was tried and reverted: in an
// actual PDF viewer/printout a page is expected to read as "a page", and a
// short, oddly-proportioned one looked wrong even though it had less blank
// space. The on-screen /sheet view has no such expectation (it's just a
// naturally-flowing web page), so it's unaffected by any of this.
const PAGE_WIDTH = 792;
const STANDARD_PAGE_HEIGHT = 612;

// Breaks one inspection's Find# columns into per-page chunks -- pure data,
// no drawing, shared by both the height-planning pass and the actual
// drawing pass below so they can never disagree about what's on which page.
function planReportPages(inspection) {
  const allPoints = inspection.points && inspection.points.length > 0
    ? inspection.points
    : uniquePoints(inspection.measurements);
  const samples = uniqueSamples(inspection.measurements);

  // Same split as InspectionSheet.jsx (the on-screen view) -- a specless
  // column with an explicit point-summary, or more than a handful of real
  // per-sample rows, reports as a qty-inspected/qty-rejected tally instead
  // of one grid column per Find# with 100+ sample rows underneath it.
  const SUMMARIZE_THRESHOLD = 10;
  const hasExplicitSummary = (p) => (inspection.pointSummaries || []).some((s) => s.balloon_point_id === p.id);
  const summaryPoints = allPoints.filter(
    (p) => isSpecless(p) && (hasExplicitSummary(p) || samples.length > SUMMARIZE_THRESHOLD)
  );
  const points = allPoints.filter((p) => !summaryPoints.includes(p));
  // A numeric column (e.g. a Surface Roughness spot-check) can need far
  // fewer actual readings than the specless columns that drove `samples` up
  // in the first place (e.g. one spot-check per lot, not one per piece) --
  // printing the full sample range here would be mostly "—" rows. Re-derive
  // the row list from only the measurements that belong to a still-gridded
  // (numeric) point.
  const gridPointIds = new Set(points.map((p) => p.id));
  const gridSamples = uniqueSamples(inspection.measurements.filter((m) => gridPointIds.has(m.balloon_point_id)));

  const pageWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
  const labelColWidth = 70;
  const minColWidth = 42;
  const maxPointsPerPage = Math.max(1, Math.floor((pageWidth - labelColWidth) / minColWidth));

  const chunks = chunk(points, maxPointsPerPage);
  const pointPages = chunks.length ? chunks : [[]];

  return { inspection, summaryPoints, pointPages, gridSamples, pageWidth, labelColWidth };
}

// Flattens one inspection's planned pages into draw jobs -- each just needs
// to know which points/page-index it is; every page is a full standard
// sheet (see PAGE_WIDTH/STANDARD_PAGE_HEIGHT above).
function buildPageJobs(plan) {
  return plan.pointPages.map((pagePoints, pageIndex) => ({
    plan,
    pagePoints,
    pageIndex,
    totalPages: plan.pointPages.length,
  }));
}

function generateInspectionPdf(res, inspection) {
  // A Final Inspection that required an Operator In-Process Data Sheet
  // bundles that companion sheet in as its own independently-paginated
  // section -- see linkedInProcess in getInspectionDetail
  // (routes/inspections.js). Its own drawHeader call already shows
  // "IN-PROCESS INSPECTION DATA SHEET" prominently, so no extra divider/
  // label is needed beyond the page break itself.
  const plans = [planReportPages(inspection)];
  if (inspection.linkedInProcess) plans.push(planReportPages(inspection.linkedInProcess));
  const jobs = plans.flatMap(buildPageJobs);

  const doc = new PDFDocument({ size: [PAGE_WIDTH, STANDARD_PAGE_HEIGHT], margin: PAGE_MARGIN });
  doc.pipe(res);

  jobs.forEach((job, i) => {
    if (i > 0) doc.addPage({ size: [PAGE_WIDTH, STANDARD_PAGE_HEIGHT], margin: PAGE_MARGIN });
    drawReportPage(doc, job);
  });

  doc.end();
}

// Draws one page of one bundled report: header always; the summary table
// only on that report's first page; the Find# grid for whatever points
// were planned onto this page; and, only on that report's last page, the
// Notes text and signature block.
function drawReportPage(doc, job) {
  const { plan, pagePoints, pageIndex, totalPages } = job;
  const { inspection, summaryPoints, gridSamples, pageWidth, labelColWidth } = plan;
  const grid = buildGrid(inspection.measurements);
  const isFirst = pageIndex === 0;
  const isLast = pageIndex === totalPages - 1;

  drawHeader(doc, inspection, pageIndex + 1, totalPages, pageWidth);
  if (isFirst && summaryPoints.length > 0) {
    drawSummaryTable(doc, summaryPoints, inspection, pageWidth);
  }
  if (pagePoints.length > 0) {
    drawGrid(doc, pagePoints, gridSamples, grid, pageWidth, labelColWidth);
  }

  if (isLast) {
    if (inspection.notes) {
      const notesX = doc.page.margins.left;
      const notesY = doc.y + 6;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text("Notes:", notesX, notesY, { continued: true });
      doc.font("Helvetica").text(` ${inspection.notes}`);
    }
    drawSignatureBlock(doc, inspection, pageWidth);
  }
}

// Matches InspectionSheet.jsx's layout: logo+company on the left, title +
// a row of type pills on the right, a rule, then a light bordered card of
// label/value fields with the Result pill as its own row underneath --
// not the old paper form's checkbox row and boxed fields.
function drawHeader(doc, inspection, pageNum, totalPages, pageWidth) {
  const startX = doc.page.margins.left;
  const topY = doc.page.margins.top;
  const pageRight = startX + pageWidth;

  const logoBoxSize = 34;
  const companyX = startX + logoBoxSize + 10;
  const companyWidth = 230;
  const titleX = companyX + companyWidth + 10;
  const titleWidth = pageRight - titleX;

  let y = topY;

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, startX, y, { fit: [logoBoxSize, logoBoxSize] });
  }

  doc.font("Helvetica-Bold").fontSize(13).fillColor(COLOR.primary).text(COMPANY.name, companyX, y, { width: companyWidth });
  doc
    .font("Helvetica-Bold")
    .fontSize(15)
    .fillColor(COLOR.primary)
    .text(TYPE_TITLES[inspection.type] ?? "INSPECTION DATA SHEET", titleX, y, { width: titleWidth, align: "right" });

  y += 15;
  doc.font("Helvetica-Oblique").fontSize(8).fillColor(COLOR.accent).text(COMPANY.tagline, companyX, y, { width: companyWidth });
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLOR.textMuted)
    .text(`Sheet ${pageNum} of ${totalPages}`, titleX, y + 1, { width: titleWidth, align: "right" });

  y += 12;
  doc.font("Helvetica").fontSize(7.5).fillColor("#555").text(COMPANY.addressLine1, companyX, y, { width: companyWidth });

  y += 11;
  doc.font("Helvetica").fontSize(7.5).fillColor("#555").text(COMPANY.addressLine2, companyX, y, { width: companyWidth });

  const chipsY = y - 2;
  drawTypeChips(doc, titleX, chipsY, titleWidth, inspection.type);

  y = Math.max(y + 11, chipsY + 16) + 10;
  doc.moveTo(startX, y).lineTo(pageRight, y).lineWidth(1.5).strokeColor(COLOR.primary).stroke();
  y += 14;

  // Incoming Inspection's paper header tracks material FROM a supplier by
  // their PO#/heat, not a customer/shop Job#-WO# -- same fields
  // InspectionCapture.jsx's INCOMING_HEADER_FIELDS captures, just laid out
  // for print here.
  const row1 =
    inspection.type === "incoming"
      ? [
          ["Part #", inspection.part_number],
          ["Quantity", inspection.quantity],
          ["Supplier", inspection.supplier],
          ["PO#", inspection.po_number],
          ["Heat #", inspection.heat],
        ]
      : [
          ["Part #", inspection.part_number],
          ["Quantity", inspection.quantity],
          ["Customer", inspection.customer || inspection.client_name],
          ["Job# / WO#", inspection.job_number],
        ];
  const row2 = [
    ["Sampling Plan N", inspection.sampling_plan_n],
    ["Sampling Plan C", inspection.sampling_plan_c],
    ["By", inspection.signature ? inspection.signature.full_name : inspection.inspector],
    ["Date", inspection.signature ? formatDate(inspection.signature.signed_at) : formatDate(inspection.date)],
  ];
  const isConditional = getResult(inspection) === "conditionally_approved";
  const rows = isConditional ? [row1, row2, [["Reason", inspection.conditional_reason]]] : [row1, row2];

  const fieldRowH = 30;
  const cardPad = 12;
  const cardH = cardPad * 2 + fieldRowH * rows.length;
  doc.roundedRect(startX, y, pageWidth, cardH, 6).fillAndStroke(COLOR.bg, COLOR.border);

  rows.forEach((fields, rowIndex) => {
    const colW = pageWidth / (rowIndex === rows.length - 1 && isConditional ? 1 : fields.length);
    fields.forEach(([label, value], i) => {
      drawMetaField(doc, startX + cardPad + i * colW, y + cardPad + rowIndex * fieldRowH, colW - cardPad, label, value);
    });
  });

  y += cardH + 10;
  drawResultBadge(doc, startX, y, inspection);
  y += 30;

  doc.x = startX;
  doc.y = y;
}

function formatDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

// Matches .report-meta-label + .report-meta-value: a small uppercase muted
// caption stacked above a bolder dark value -- one cell of the meta card.
function drawMetaField(doc, x, y, w, label, value) {
  doc.font("Helvetica-Bold").fontSize(7).fillColor(COLOR.labelMuted).text(String(label).toUpperCase(), x, y, { width: w, characterSpacing: 0.3 });
  doc
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .fillColor(COLOR.text)
    .text(value != null && value !== "" ? String(value) : "—", x, y + 10, { width: w });
  doc.fillColor("#000");
}

// Matches .result-badge: a rounded pill, solid color + white text for a
// decided result, light warn tint for in_progress. Rendered as its own
// "RESULT" meta field, same caption styling as drawMetaField.
function drawResultBadge(doc, x, y, inspection) {
  doc.font("Helvetica-Bold").fontSize(7).fillColor(COLOR.labelMuted).text("RESULT", x, y, { characterSpacing: 0.3 });

  const result = getResult(inspection);
  const bg =
    result === "approved" ? COLOR.ok
    : result === "conditionally_approved" ? COLOR.conditional
    : result === "rejected" ? COLOR.fail
    : COLOR.warnBg;
  const textColor = result === "in_progress" ? COLOR.warn : "#fff";
  const label = RESULT_LABELS[result] ?? String(result).toUpperCase();
  const hasIcon = result === "approved" || result === "conditionally_approved" || result === "rejected";

  const badgeY = y + 11;
  const badgeH = 18;
  const padX = 11;
  const iconSize = 8;
  const iconGap = 5;
  doc.font("Helvetica-Bold").fontSize(9.5);
  const textW = doc.widthOfString(label);
  const contentW = textW + (hasIcon ? iconSize + iconGap : 0);
  const badgeW = contentW + padX * 2;

  doc.roundedRect(x, badgeY, badgeW, badgeH, badgeH / 2).fill(bg);

  let cursorX = x + (badgeW - contentW) / 2;
  if (hasIcon) {
    drawBadgeIcon(doc, cursorX, badgeY + badgeH / 2, iconSize, textColor, result === "rejected" ? "x" : "check");
    cursorX += iconSize + iconGap;
  }
  doc.fillColor(textColor).text(label, cursorX, badgeY + 5, { width: textW, lineBreak: false });
  doc.fillColor("#000");
}

// PDFKit's standard fonts only support WinAnsi encoding, not a real
// checkmark/X glyph, so the badges' icons are drawn as vector strokes.
function drawBadgeIcon(doc, x, cy, size, color, kind) {
  doc.lineWidth(1.4).strokeColor(color).lineJoin("round").lineCap("round");
  const y = cy - size / 2;
  if (kind === "check") {
    doc
      .moveTo(x, y + size * 0.55)
      .lineTo(x + size * 0.38, y + size * 0.85)
      .lineTo(x + size, y + size * 0.15)
      .stroke();
  } else {
    doc.moveTo(x, y).lineTo(x + size, y + size).stroke();
    doc.moveTo(x + size, y).lineTo(x, y + size).stroke();
  }
}

// Matches .type-indicator/.type-chip: a right-aligned row of small pill
// labels, one per inspection type, with the current type highlighted --
// not the paper form's checkbox-and-label grid.
function drawTypeChips(doc, x, y, availableWidth, currentType) {
  const gap = 5;
  const h = 14;
  doc.font("Helvetica").fontSize(8);
  const widths = TYPE_CHIPS.map(([, label]) => doc.widthOfString(label) + 12);
  const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (TYPE_CHIPS.length - 1);
  let cx = x + availableWidth - totalWidth;

  TYPE_CHIPS.forEach(([key, label], i) => {
    const w = widths[i];
    const active = key === currentType;
    if (active) {
      doc.roundedRect(cx, y, w, h, 3).fillAndStroke(COLOR.accentTint, COLOR.accent);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(COLOR.accent);
    } else {
      doc.roundedRect(cx, y, w, h, 3).strokeColor(COLOR.border).stroke();
      doc.font("Helvetica").fontSize(8).fillColor("#888");
    }
    doc.text(label, cx, y + 3.5, { width: w, align: "center", lineBreak: false });
    cx += w + gap;
  });
  doc.fillColor("#000");
}

// Matches the summary table's inline Result pill (same .result-badge as
// above, just small enough to sit inside a table cell).
function drawMiniBadge(doc, cx, cy, label, kind) {
  const bg = kind === "ok" ? COLOR.ok : COLOR.fail;
  const iconSize = 6;
  const iconGap = 4;
  doc.font("Helvetica-Bold").fontSize(7.5);
  const padX = 8;
  const textW = doc.widthOfString(label);
  const contentW = textW + iconSize + iconGap;
  const w = contentW + padX * 2;
  const h = 14;
  const x = cx - w / 2;
  const y = cy - h / 2;
  doc.roundedRect(x, y, w, h, h / 2).fill(bg);

  const contentX = x + (w - contentW) / 2;
  drawBadgeIcon(doc, contentX, cy, iconSize, "#fff", kind === "ok" ? "check" : "x");
  doc.fillColor("#fff").text(label, contentX + iconSize + iconGap, y + 3.5, { width: textW, lineBreak: false });
  doc.fillColor("#000");
}

function drawGrid(doc, pagePoints, samples, grid, pageWidth, labelColWidth) {
  const startX = doc.page.margins.left;
  let y = doc.y;
  const colW = pagePoints.length > 0 ? (pageWidth - labelColWidth) / pagePoints.length : pageWidth - labelColWidth;
  const rowH = 16;

  drawCell(doc, startX, y, labelColWidth, rowH, "Find #", { bold: true, labelFill: true });
  pagePoints.forEach((p, i) => {
    drawCell(doc, startX + labelColWidth + i * colW, y, colW, rowH, String(p.balloon_number), { bold: true });
  });
  y += rowH;

  const specRows = [
    ["Max. Spec.", (p) => p.max_spec],
    ["MEAN", (p) => p.mean_value],
    ["Min. Spec.", (p) => p.min_spec],
  ];
  specRows.forEach(([label, getter], idx) => {
    const isLast = idx === specRows.length - 1;
    drawCell(doc, startX, y, labelColWidth, rowH, label, { bold: true, labelFill: true, thickBottom: isLast });
    pagePoints.forEach((p, i) => {
      const v = getter(p);
      const text = v != null ? v.toFixed(p.decimal_places ?? 3) : "";
      drawCell(doc, startX + labelColWidth + i * colW, y, colW, rowH, text, { bold: true, specFill: true, thickBottom: isLast });
    });
    y += rowH;
  });

  samples.forEach((s, rowIndex) => {
    const sampleLabel = Number.isInteger(s) ? String(s) : s.toFixed(1);
    const alt = rowIndex % 2 === 1;
    drawCell(doc, startX, y, labelColWidth, rowH, sampleLabel, { bold: true, labelFill: true });
    pagePoints.forEach((p, i) => {
      const cell = grid[`${p.id}:${s}`];
      const raw = cell?.measured_value;
      const text = raw == null ? "" : typeof raw === "number" ? raw.toFixed(p.decimal_places ?? 3) : String(raw);
      const outOfTolerance = Boolean(cell && cell.within_tolerance === 0);
      drawCell(doc, startX + labelColWidth + i * colW, y, colW, rowH, text, { danger: outOfTolerance, altFill: alt && !outOfTolerance });
    });
    y += rowH;
  });

  doc.x = startX;
  doc.y = y + 10;
}

function drawCell(doc, x, y, w, h, text, opts = {}) {
  const { bold = false, danger = false, labelFill = false, specFill = false, altFill = false, thickBottom = false } = opts;

  let fill = null;
  if (danger) fill = COLOR.failFill;
  else if (labelFill) fill = COLOR.labelColBg;
  else if (specFill) fill = COLOR.bg;
  else if (altFill) fill = COLOR.altFill;

  if (fill) {
    doc.rect(x, y, w, h).fill(fill);
  }
  doc.rect(x, y, w, h).strokeColor(COLOR.border).stroke();
  if (thickBottom) {
    doc.moveTo(x, y + h).lineTo(x + w, y + h).lineWidth(1.5).strokeColor(COLOR.primary).stroke();
  }

  if (danger) {
    // Small triangular flag in the corner -- a subtler complement to the red
    // text/fill rather than crowding the centered value.
    const flagSize = 5;
    doc
      .polygon([x + w - flagSize, y], [x + w, y], [x + w, y + flagSize])
      .fill(COLOR.fail);
  }

  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7);
  doc.fillColor(danger ? COLOR.fail : COLOR.text);
  doc.text(text, x + 2, y + 4, { width: w - 4, height: h - 4, align: labelFill ? "left" : "center" });
  doc.fillColor("#000");
}

function drawSignatureBlock(doc, inspection, pageWidth) {
  const startX = doc.page.margins.left;
  const y = doc.y + 24;
  const colWidth = (pageWidth - 60) / 2;

  const signedName = inspection.signature ? inspection.signature.full_name : null;
  const signedDate = inspection.signature ? formatDateTime(inspection.signature.signed_at) : null;

  const lineY = y + 26;

  if (signedName) {
    doc.font("Helvetica-Oblique").fontSize(16).fillColor("#1a1a1a").text(signedName, startX, y, { width: colWidth, align: "center" });
  }
  doc.moveTo(startX, lineY).lineTo(startX + colWidth, lineY).strokeColor("#1a1a1a").lineWidth(1).stroke();
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#666")
    .text(signedName ? "Inspector signature · electronically signed" : "Inspector signature", startX, lineY + 4, {
      width: colWidth,
      align: "center",
    });

  const col2X = startX + colWidth + 60;
  if (signedDate) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1a1a1a").text(signedDate, col2X, y + 5, { width: colWidth, align: "center" });
  }
  doc.moveTo(col2X, lineY).lineTo(col2X + colWidth, lineY).strokeColor("#1a1a1a").lineWidth(1).stroke();
  doc.font("Helvetica").fontSize(8).fillColor("#666").text("Date", col2X, lineY + 4, { width: colWidth, align: "center" });
  doc.fillColor("#000");
}

function formatDateTime(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function uniquePoints(measurements) {
  const map = new Map();
  measurements.forEach((m) => {
    if (!map.has(m.balloon_point_id)) {
      map.set(m.balloon_point_id, {
        id: m.balloon_point_id,
        balloon_number: m.balloon_number,
        max_spec: m.max_spec,
        min_spec: m.min_spec,
        mean_value: m.mean_value,
        sort_order: m.sort_order,
        decimal_places: m.decimal_places,
      });
    }
  });
  return [...map.values()].sort((a, b) => a.sort_order - b.sort_order);
}

function uniqueSamples(measurements) {
  return [...new Set(measurements.map((m) => m.sample_number))].sort((a, b) => a - b);
}

function buildGrid(measurements) {
  const grid = {};
  measurements.forEach((m) => {
    grid[`${m.balloon_point_id}:${m.sample_number}`] = m;
  });
  return grid;
}

function chunk(arr, size) {
  if (arr.length === 0) return [];
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Mirrors frontend/src/lib/passfail.js -- kept separately since this is a
// plain Node file with no shared module boundary with the frontend build.
function isSpecless(point) {
  return point.max_spec == null && point.min_spec == null && point.mean_value == null;
}

const NOT_OK_PREFIX = "NOT OK";

function parsePassFail(raw) {
  const trimmed = (raw ?? "").toString().trim();
  const upper = trimmed.toUpperCase();
  if (upper === "OK") return { state: "ok", reason: "" };
  if (upper.startsWith(NOT_OK_PREFIX)) {
    return { state: "not_ok", reason: trimmed.slice(NOT_OK_PREFIX.length).replace(/^[\s—-]+/, "") };
  }
  return { state: null, reason: "" };
}

// Mirrors frontend/src/lib/passfail.js's summarizeCheckPoint -- prefers an
// explicit inspection_point_summaries row, otherwise derives the same shape
// from the point's individual measurements (a legacy/"Fill + Mark OK" sheet).
function summarizeCheckPoint(point, inspection) {
  const explicit = (inspection.pointSummaries || []).find((s) => s.balloon_point_id === point.id);
  if (explicit) {
    return {
      qtyInspected: explicit.qty_inspected,
      qtyRejected: explicit.qty_rejected,
      rejectNotes: explicit.reject_notes || "",
    };
  }

  let qtyInspected = 0;
  let qtyRejected = 0;
  const reasons = [];
  (inspection.measurements || [])
    .filter((m) => m.balloon_point_id === point.id)
    .forEach((m) => {
      if (m.measured_value == null || m.measured_value === "") return;
      qtyInspected += 1;
      const { state, reason } = parsePassFail(m.measured_value);
      if (state === "not_ok") {
        qtyRejected += 1;
        if (reason) reasons.push(reason);
      }
    });
  return { qtyInspected, qtyRejected, rejectNotes: reasons.join("; ") };
}

// Row-per-Find# table (not transposed, unlike drawGrid) for specless columns
// summarized as a qty-inspected/qty-rejected tally instead of one column per
// sample -- see summarizeCheckPoint above for which sheets this applies to.
function drawSummaryTable(doc, summaryPoints, inspection, pageWidth) {
  const startX = doc.page.margins.left;
  let y = doc.y;
  const rowH = 16;

  const rows = summaryPoints.map((p) => ({ point: p, ...summarizeCheckPoint(p, inspection) }));
  // Reject Notes is just a column of "—" on a sheet where everything
  // passed -- only draw it when at least one row actually has something to
  // say, same as InspectionSheet.jsx (the on-screen view).
  const hasAnyReject = rows.some((r) => r.qtyRejected > 0);

  const findColW = 90;
  const qtyColW = 80;
  const resultColW = 90;
  const notesColW = pageWidth - findColW - qtyColW * 2 - resultColW;
  const cols = [{ key: "find", label: "Find #", w: findColW }, { key: "qtyInspected", label: "Qty Inspected", w: qtyColW }, { key: "qtyRejected", label: "Qty Rejected", w: qtyColW }];
  if (hasAnyReject) cols.push({ key: "notes", label: "Reject Notes", w: notesColW });
  cols.push({ key: "result", label: "Result", w: resultColW + (hasAnyReject ? 0 : notesColW) });

  let x = startX;
  cols.forEach((c) => {
    drawCell(doc, x, y, c.w, rowH, c.label, { bold: true, labelFill: c.key === "find" });
    x += c.w;
  });
  y += rowH;

  rows.forEach(({ point, qtyInspected, qtyRejected, rejectNotes }, rowIndex) => {
    const rejected = qtyRejected > 0;
    const alt = rowIndex % 2 === 1;
    const textByKey = {
      find: String(point.balloon_number),
      qtyInspected: String(qtyInspected),
      qtyRejected: String(qtyRejected),
      notes: rejectNotes || "—",
    };
    x = startX;
    cols.forEach((c) => {
      if (c.key === "result") {
        drawCell(doc, x, y, c.w, rowH, "", { altFill: alt });
        drawMiniBadge(doc, x + c.w / 2, y + rowH / 2, rejected ? `${qtyRejected} REJECTED` : "APPROVED", rejected ? "fail" : "ok");
      } else {
        drawCell(doc, x, y, c.w, rowH, textByKey[c.key], {
          altFill: alt,
          labelFill: c.key === "find",
          bold: c.key === "find",
        });
      }
      x += c.w;
    });
    y += rowH;
  });

  doc.x = startX;
  doc.y = y + 10;
}

module.exports = { generateInspectionPdf };
