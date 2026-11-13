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
  ["incoming", "Incoming"],
  ["setup", "Set Up"],
  ["in_process", "In Process"],
  ["final", "Final"],
  ["samples", "Samples"],
];

const TYPE_TITLES = {
  quote: "QUOTE INSPECTION DATA SHEET",
  incoming: "INCOMING INSPECTION DATA SHEET",
  setup: "SET-UP INSPECTION DATA SHEET",
  in_process: "IN-PROCESS INSPECTION DATA SHEET",
  final: "FINAL INSPECTION DATA SHEET",
  other: "INSPECTION DATA SHEET",
  samples: "SAMPLES INSPECTION DATA SHEET",
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

// machine_log_mode's three extra fixed-width columns on the Find# grid (see
// InspectionSheet.jsx's matching layout) -- Qty/Machine # sit right after
// the sample-number label column, Comment sits after every Find# column.
// Subtracted from the available width before laying out the Find# columns
// themselves (both for pagination math and the actual per-column width),
// same as labelColWidth already is.
const QTY_COL_WIDTH = 30;
const MACHINE_COL_WIDTH = 50;
const COMMENT_COL_WIDTH = 110;
const MACHINE_LOG_COLS_WIDTH = QTY_COL_WIDTH + MACHINE_COL_WIDTH + COMMENT_COL_WIDTH;

// Find# grid column sizing: each column is as wide as its widest text (7pt,
// see drawCell) plus CELL_PAD, never narrower than MIN_COL_WIDTH -- and never
// wider than MAX_NATURAL_COL_WIDTH just because one cell holds a long
// "NOT OK — reason" (that cell wraps/clips instead of widening the column).
// Sizing to content rather than a fixed minimum lets a 19-column sheet of
// short numbers fit one page width; a fixed 36pt minimum split one such
// sheet 18 + 1, printing the lone leftover column as its own full report.
const GRID_FONT_SIZE = 7;
const CELL_PAD = 8;
const MIN_COL_WIDTH = 26;
const MAX_NATURAL_COL_WIDTH = 80;
const GRID_ROW_LABELS = ["Find #", "Max. Spec.", "MEAN", "Min. Spec."];

// Which Find# columns go in the grid vs. the check-column tally table, and
// which sample rows print -- pure data, shared with the Excel export
// (backend/src/excel/inspectionSheet.js) so both exports always agree.
function getSheetLayout(inspection) {
  const allPoints = inspection.points && inspection.points.length > 0
    ? inspection.points
    : uniquePoints(inspection.measurements);
  // A machine-log row can carry only a Qty/Machine #/Comment and no reading.
  const samples = [
    ...new Set([
      ...uniqueSamples(inspection.measurements),
      ...(inspection.machine_log_mode ? (inspection.sampleRows || []).map((r) => r.sample_number) : []),
    ]),
  ].sort((a, b) => a - b);

  // Same split as InspectionSheet.jsx (the on-screen view) -- a specless
  // column reports as a qty-inspected/qty-rejected tally only when it has an
  // explicit point-summary, the 100% Inspection flag is set, or there are
  // more than a handful of rows and the sheet is either an implied 100%
  // inspection (the sampling plan covers the whole quantity) or nothing but
  // check columns. A short implied-100% sheet (e.g. a 5-piece FAI, n=5) and
  // a check sampled alongside measured dimensions both stay in the grid.
  const SUMMARIZE_THRESHOLD = 10;
  const hasExplicitSummary = (p) => (inspection.pointSummaries || []).some((s) => s.balloon_point_id === p.id);
  const planN = Number(inspection.sampling_plan_n);
  const qty = Number(inspection.quantity);
  const impliedHundredPercent = qty > 0 && planN >= qty;
  const onlyCheckColumns = allPoints.length > 0 && allPoints.every(isSpecless);
  // A machine log keeps every row (each has its own Qty/Machine #/Comment) --
  // only an explicit 100% Inspection flag turns its checks into a tally.
  const summarizeChecks = inspection.machine_log_mode
    ? !!inspection.hundred_percent_inspection
    : !!inspection.hundred_percent_inspection ||
      ((impliedHundredPercent || onlyCheckColumns) && samples.length > SUMMARIZE_THRESHOLD);
  const summaryPoints = allPoints.filter((p) => isSpecless(p) && (hasExplicitSummary(p) || summarizeChecks));
  const points = allPoints.filter((p) => !summaryPoints.includes(p));
  // A numeric column (e.g. a Surface Roughness spot-check) can need far
  // fewer actual readings than the specless columns that drove `samples` up
  // in the first place (e.g. one spot-check per lot, not one per piece) --
  // printing the full sample range here would be mostly "—" rows. Re-derive
  // the row list from only the measurements that belong to a still-gridded
  // (numeric) point.
  const gridPointIds = new Set(points.map((p) => p.id));
  // No specless columns narrowing the row list down (see the comment right
  // above) -- safe to print the full planned row count, not just whatever's
  // actually been measured so far.
  const gridSamples = summaryPoints.length === 0
    ? withPlannedSamples(samples, inspection)
    : uniqueSamples(inspection.measurements.filter((m) => gridPointIds.has(m.balloon_point_id)));

  const machineLogMode = !!inspection.machine_log_mode;
  const sampleRowsByNumber = Object.fromEntries((inspection.sampleRows || []).map((r) => [r.sample_number, r]));

  return { summaryPoints, points, gridSamples, machineLogMode, sampleRowsByNumber };
}

// Breaks one inspection's Find# columns into column groups (each one a full
// set of sample rows, drawn one after another) -- pure data, no drawing, so
// the grouping and the per-column widths are decided once, up front.
function planReportPages(inspection, doc) {
  const { summaryPoints, points, gridSamples, machineLogMode, sampleRowsByNumber } = getSheetLayout(inspection);

  const pageWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
  const grid = buildGrid(inspection.measurements);
  const textWidth = (text, bold) =>
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(GRID_FONT_SIZE).widthOfString(String(text));

  const labelColWidth =
    Math.max(...GRID_ROW_LABELS.map((l) => textWidth(l, true)), ...gridSamples.map((s) => textWidth(formatSampleLabel(s), true))) +
    CELL_PAD;

  const naturalWidths = points.map((p) => {
    const widest = Math.max(
      textWidth(p.balloon_number, true),
      ...SPEC_GETTERS.map((get) => textWidth(formatSpecValue(p, get(p)), true)),
      ...gridSamples.map((s) => textWidth(formatCellValue(p, grid[`${p.id}:${s}`]?.measured_value), false))
    );
    return Math.min(MAX_NATURAL_COL_WIDTH, Math.max(MIN_COL_WIDTH, widest + CELL_PAD));
  });

  const availableWidth = pageWidth - labelColWidth - (machineLogMode ? MACHINE_LOG_COLS_WIDTH : 0);
  const pointGroups = splitColumnGroups(naturalWidths, availableWidth).map(([start, end]) => {
    const widths = naturalWidths.slice(start, end);
    // Every group fills the full grid width, sharing the leftover space out
    // evenly -- groups are balanced (see splitColumnGroups), so no group is
    // left as one or two columns stretched across the whole page.
    const extra = (availableWidth - widths.reduce((a, b) => a + b, 0)) / Math.max(1, widths.length);
    return { points: points.slice(start, end), colWidths: widths.map((w) => w + extra) };
  });

  return {
    inspection,
    summaryPoints,
    pointGroups,
    gridSamples,
    pageWidth,
    labelColWidth,
    machineLogMode,
    sampleRowsByNumber,
  };
}

// Splits columns (by their widths) into the fewest contiguous groups that
// each fit `available`, with column counts as even as possible -- 25 columns
// that need two groups print as 13 + 12, not 21 + 4. Returns [start, end)
// index pairs; always at least one (possibly empty) group.
function splitColumnGroups(widths, available) {
  const n = widths.length;
  if (n === 0) return [[0, 0]];
  for (let g = 1; g <= n; g++) {
    const bounds = Array.from({ length: g }, (_, k) => [Math.round((k * n) / g), Math.round(((k + 1) * n) / g)]);
    const fits = bounds.every(([s, e]) => widths.slice(s, e).reduce((a, b) => a + b, 0) <= available);
    if (fits) return bounds;
  }
  return widths.map((_, i) => [i, i + 1]);
}

// Flattens one inspection's column groups into draw jobs -- each just needs
// to know which points/group-index it is.
function buildPageJobs(plan) {
  return plan.pointGroups.map((group, groupIndex) => ({
    plan,
    group,
    groupIndex,
    groupCount: plan.pointGroups.length,
  }));
}

function generateInspectionPdf(res, inspection) {
  // A Final Inspection that required an Operator In-Process Data Sheet
  // bundles each companion sheet (one per Operator operation) in as its own
  // independently-paginated section -- see linkedInProcesses in
  // getInspectionDetail (routes/inspections.js). Each one's drawHeader call already shows
  // "IN-PROCESS INSPECTION DATA SHEET" prominently, so no extra divider/
  // label is needed beyond the page break itself.
  // bufferPages so "Sheet X of Y" can be stamped after the fact -- a long
  // grid spills rows onto continuation pages (see newContinuationPage), so
  // the real page count per report isn't known until everything's drawn.
  const doc = new PDFDocument({ size: [PAGE_WIDTH, STANDARD_PAGE_HEIGHT], margin: PAGE_MARGIN, bufferPages: true });
  doc.pipe(res);

  // Planned against the doc so column widths come from real text metrics.
  const plans = [planReportPages(inspection, doc)];
  (inspection.linkedInProcesses || []).forEach((linked) => plans.push(planReportPages(linked, doc)));
  const jobs = plans.flatMap(buildPageJobs);

  const currentPage = () => doc.bufferedPageRange().count - 1;
  const firstPageOfPlan = new Map();
  jobs.forEach((job, i) => {
    // Only a new report starts a fresh page; a report's later column groups
    // pick up right below the previous one (drawGrid breaks to a
    // continuation page itself if there isn't room).
    if (i > 0 && job.groupIndex === 0) doc.addPage({ size: [PAGE_WIDTH, STANDARD_PAGE_HEIGHT], margin: PAGE_MARGIN });
    if (!firstPageOfPlan.has(job.plan)) firstPageOfPlan.set(job.plan, currentPage());
    drawReportPage(doc, job);
  });

  const starts = plans.map((p) => firstPageOfPlan.get(p));
  const totalPageCount = currentPage() + 1;
  plans.forEach((plan, i) => {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : totalPageCount;
    for (let page = start; page < end; page++) {
      doc.switchToPage(page);
      drawSheetNumber(doc, page - start + 1, end - start, plan.pageWidth);
    }
  });

  doc.flushPages();
  doc.end();
}

const PAGE_BOTTOM = STANDARD_PAGE_HEIGHT - PAGE_MARGIN;
const SHEET_LABEL_Y = PAGE_MARGIN + 16;
// Same right-hand column the header's title sits in (see drawHeader).
const TITLE_X_OFFSET = 34 + 10 + 230 + 10;

function drawSheetNumber(doc, pageNum, totalPages, pageWidth) {
  const titleX = PAGE_MARGIN + TITLE_X_OFFSET;
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLOR.textMuted)
    .text(`Sheet ${pageNum} of ${totalPages}`, titleX, SHEET_LABEL_Y, {
      width: PAGE_MARGIN + pageWidth - titleX,
      align: "right",
      lineBreak: false,
    });
  doc.fillColor("#000");
}

// A page for rows/signature that didn't fit on the previous one: no full
// header card, just a one-line "continued" caption (the sheet number is
// stamped at the same height afterwards). Returns the y to resume drawing at.
function newContinuationPage(doc, inspection) {
  doc.addPage({ size: [PAGE_WIDTH, STANDARD_PAGE_HEIGHT], margin: PAGE_MARGIN });
  const title = TYPE_TITLES[inspection.type] ?? "INSPECTION DATA SHEET";
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(COLOR.primary)
    .text(`${title} — Part # ${inspection.part_number ?? ""} Rev ${inspection.drawing_rev || "N/A"} (continued)`, PAGE_MARGIN, SHEET_LABEL_Y, {
      lineBreak: false,
    });
  doc.fillColor("#000");
  return SHEET_LABEL_Y + 20;
}

// Notes line (if any) + the signature block below it.
function notesAndSignatureHeight(doc, inspection, pageWidth) {
  let h = 64; // drawSignatureBlock's own footprint below doc.y
  if (inspection.notes) {
    doc.font("Helvetica").fontSize(9);
    h += 6 + doc.heightOfString(`Notes: ${inspection.notes}`, { width: pageWidth });
  }
  return h;
}

// Draws one column group of one bundled report: the header card and
// summary table only for the first group; the Find# grid for this group's
// points; and, only after the last group, the Notes text and signature block.
function drawReportPage(doc, job) {
  const { plan, group, groupIndex, groupCount } = job;
  const { inspection, summaryPoints, gridSamples, pageWidth, labelColWidth, machineLogMode, sampleRowsByNumber } =
    plan;
  const grid = buildGrid(inspection.measurements);
  const isFirst = groupIndex === 0;
  const isLast = groupIndex === groupCount - 1;

  const newPage = () => newContinuationPage(doc, inspection);

  if (isFirst) {
    drawHeader(doc, inspection, pageWidth);
    if (summaryPoints.length > 0) drawSummaryTable(doc, summaryPoints, inspection, pageWidth, newPage);
  } else {
    doc.y += 8;
  }
  if (group.points.length > 0) {
    drawGrid(doc, group.points, group.colWidths, gridSamples, grid, labelColWidth, machineLogMode, sampleRowsByNumber, newPage);
  }

  if (isLast) {
    if (doc.y + notesAndSignatureHeight(doc, inspection, pageWidth) > PAGE_BOTTOM) {
      doc.x = doc.page.margins.left;
      doc.y = newPage();
    }
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
// label/value fields with the Result pill in its own panel on the right --
// not the old paper form's checkbox row and boxed fields.
function drawHeader(doc, inspection, pageWidth) {
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
  // "Sheet X of Y" goes here (y + 1) too, but is stamped afterwards by
  // drawSheetNumber once the real page count is known.

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
  const fields = getMetaFields(inspection, formatDate(inspection.date));
  // Always exactly two rows sharing one column grid, so every label lines
  // up under the one above it whatever the field count (9 for Final, 10
  // with an Operation or Incoming's Heat #).
  const cols = Math.ceil(fields.length / 2);
  const isConditional = getResult(inspection) === "conditionally_approved";

  const cardPad = 14;
  const fieldRowH = 32;
  const resultPanelW = 180;
  const fieldsX = startX + cardPad;
  const fieldsW = pageWidth - resultPanelW - cardPad * 2;
  // Each column is as wide as its widest cell, plus an even share of the
  // leftover space -- so a long Part # gets room instead of being cut off,
  // and only shrinks (then ellipsizes) if the whole row truly can't fit.
  const colGap = 14;
  const natural = Array.from({ length: cols }, (_, c) =>
    [fields[c], fields[c + cols]].filter(Boolean).reduce((w, [label, value]) => {
      doc.font("Helvetica-Bold").fontSize(7);
      const labelW = doc.widthOfString(String(label).toUpperCase(), { characterSpacing: 0.3 });
      doc.fontSize(10.5);
      return Math.max(w, labelW, doc.widthOfString(metaDisplay(value)));
    }, 0) + colGap
  );
  const naturalTotal = natural.reduce((a, b) => a + b, 0);
  const colWidths =
    naturalTotal <= fieldsW
      ? natural.map((w) => w + (fieldsW - naturalTotal) / cols)
      : natural.map((w) => (w * fieldsW) / naturalTotal);
  const colX = colWidths.map((_, c) => fieldsX + colWidths.slice(0, c).reduce((a, b) => a + b, 0));

  let reasonH = 0;
  if (isConditional) {
    doc.font("Helvetica-Bold").fontSize(10.5);
    reasonH = 10 + doc.heightOfString(inspection.conditional_reason || "—", { width: fieldsW }) + 8;
  }
  const cardH = cardPad * 2 + fieldRowH * 2 + reasonH - 6;
  doc.roundedRect(startX, y, pageWidth, cardH, 6).fillAndStroke(COLOR.bg, COLOR.border);

  fields.forEach(([label, value], i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    drawMetaField(doc, colX[col], y + cardPad + row * fieldRowH, colWidths[col] - colGap, label, value);
  });
  if (isConditional) {
    drawMetaField(doc, fieldsX, y + cardPad + fieldRowH * 2, fieldsW, "Reason", inspection.conditional_reason, true);
  }

  // Result gets its own panel on the right, divided off and centered, so it
  // reads as the sheet's verdict rather than one more field in the grid.
  const panelX = startX + pageWidth - resultPanelW;
  doc
    .moveTo(panelX, y + 10)
    .lineTo(panelX, y + cardH - 10)
    .lineWidth(1)
    .strokeColor(COLOR.border)
    .stroke();
  drawResultBadge(doc, panelX, y + cardH / 2 - 15, inspection, resultPanelW);

  y += cardH + 16;

  doc.x = startX;
  doc.y = y;
}

// MM/DD/YYYY -- mirrors frontend/src/lib/format.js's formatDate: rearranges
// the stored "YYYY-MM-DD" as text so it can never shift a day across zones.
function formatDate(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(value);
}

// Matches .report-meta-label + .report-meta-value: a small uppercase muted
// caption stacked above a bolder dark value -- one cell of the meta card.
// Grid cells stay on one line (ellipsized) so a long customer name can't
// spill into the row below; `wrap` is for the full-width Reason row.
function drawMetaField(doc, x, y, w, label, value, wrap = false) {
  doc.font("Helvetica-Bold").fontSize(7).fillColor(COLOR.labelMuted).text(String(label).toUpperCase(), x, y, { width: w, characterSpacing: 0.3 });
  doc
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .fillColor(COLOR.text)
    .text(
      metaDisplay(value),
      x,
      y + 10,
      wrap ? { width: w } : { width: w, height: 13, ellipsis: true, lineBreak: false }
    );
  doc.fillColor("#000");
}

function metaDisplay(value) {
  return value != null && value !== "" ? String(value) : "—";
}

// QC's Set-up and QC's In-Process sheets don't record a total lot quantity
// on paper -- only Final, Incoming, and the Operator's own In-Process sheet
// do. Mirrors frontend/src/lib/format.js's showsQuantity.
function showsQuantity(inspection) {
  if (inspection.type === "setup") return false;
  if (inspection.type === "in_process") return inspection.operation_scope === "in_process_operator";
  return true;
}

// The header card's fields in reading order: who/what first (row 1), then
// the inspection's own numbers and sign-off (row 2). Incoming tracks
// material FROM a supplier by PO#/heat instead of a customer Job#-WO# --
// same fields InspectionCapture.jsx's INCOMING_HEADER_FIELDS captures.
// Set-up / In-Process sheets are scoped to one operation on the part
// (e.g. "Bending"), so that's named too. Mirrors InspectionSheet.jsx.
function getMetaFields(inspection, date) {
  const operationName = inspection.operation_name || inspection.operation;
  return [
    ["Part #", inspection.part_number],
    ["Rev", inspection.drawing_rev || "N/A"],
    ...(inspection.type === "incoming"
      ? [
          ["Supplier", inspection.supplier],
          ["PO#", inspection.po_number],
          ["Heat #", inspection.heat],
        ]
      : [
          ["Customer", inspection.customer || inspection.client_name],
          ["Job# / WO#", inspection.job_number],
        ]),
    ...(operationName ? [["Operation", operationName]] : []),
    ...(showsQuantity(inspection) ? [["Quantity", inspection.quantity]] : []),
    ["Sampling Plan", inspection.sampling_plan_n],
    ["Total Rejected", inspection.sampling_plan_c],
    ["By", inspection.signature ? inspection.signature.full_name : inspection.inspector],
    ["Date", date],
  ];
}

// Matches .result-badge: a rounded pill, solid color + white text for a
// decided result, light warn tint for in_progress, under a "RESULT"
// caption styled like drawMetaField's -- both centered within panelW.
function drawResultBadge(doc, x, y, inspection, panelW) {
  doc.font("Helvetica-Bold").fontSize(7).fillColor(COLOR.labelMuted).text("RESULT", x, y, { width: panelW, align: "center", characterSpacing: 0.3 });

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

  const badgeX = x + (panelW - badgeW) / 2;
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, badgeH / 2).fill(bg);

  let cursorX = badgeX + (badgeW - contentW) / 2;
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

// Spec-row getters, in the order the Max. Spec. / MEAN / Min. Spec. rows print.
const SPEC_GETTERS = [(p) => p.max_spec, (p) => p.mean_value, (p) => p.min_spec];

// Reference dimensions print in parentheses, same as on the drawing.
function formatSpecValue(p, v) {
  const num = v != null ? v.toFixed(p.decimal_places ?? 3) : "";
  return num && p.is_reference ? `(${num})` : num;
}

function formatCellValue(p, raw) {
  return raw == null ? "" : typeof raw === "number" ? raw.toFixed(p.decimal_places ?? 3) : String(raw);
}

function formatSampleLabel(s) {
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

function drawGrid(doc, pagePoints, colWidths, samples, grid, labelColWidth, machineLogMode, sampleRowsByNumber, newPage) {
  const startX = doc.page.margins.left;
  let y = doc.y;
  // machine_log_mode's three extra columns: Qty/Machine # sit between the
  // label column and the Find# columns, Comment sits after them -- see
  // MACHINE_LOG_COLS_WIDTH's comment, already subtracted out of the width
  // planReportPages shared out into colWidths.
  const qtyX = startX + labelColWidth;
  const machineX = qtyX + QTY_COL_WIDTH;
  const pointsStartX = machineLogMode ? machineX + MACHINE_COL_WIDTH : startX + labelColWidth;
  const colX = colWidths.map((_, i) => pointsStartX + colWidths.slice(0, i).reduce((a, b) => a + b, 0));
  const commentX = pointsStartX + colWidths.reduce((a, b) => a + b, 0);
  const rowH = 16;

  // Repeated at the top of every continuation page so a spilled-over row
  // still reads against its Find# column.
  const drawColumnHeaderRow = () => {
    drawCell(doc, startX, y, labelColWidth, rowH, "Find #", { bold: true, labelFill: true });
    if (machineLogMode) {
      drawCell(doc, qtyX, y, QTY_COL_WIDTH, rowH, "Qty", { bold: true, labelFill: true });
      drawCell(doc, machineX, y, MACHINE_COL_WIDTH, rowH, "Machine #", { bold: true, labelFill: true });
    }
    pagePoints.forEach((p, i) => {
      drawCell(doc, colX[i], y, colWidths[i], rowH, String(p.balloon_number), { bold: true });
    });
    if (machineLogMode) {
      drawCell(doc, commentX, y, COMMENT_COL_WIDTH, rowH, "Comment", { bold: true, labelFill: true });
    }
    y += rowH;
  };

  // Header row + the three spec rows stay together with at least one sample row.
  if (y + rowH * 5 > PAGE_BOTTOM) y = newPage();
  drawColumnHeaderRow();

  // Same as InspectionCapture.jsx's hasAnySpec: a sheet with no spec values
  // at all (e.g. a Go/No-Go/Visual machine log) skips three empty rows.
  const hasAnySpec = pagePoints.some((p) => p.max_spec != null || p.min_spec != null || p.mean_value != null);
  const specRows = hasAnySpec ? GRID_ROW_LABELS.slice(1).map((label, i) => [label, SPEC_GETTERS[i]]) : [];
  specRows.forEach(([label, getter], idx) => {
    const isLast = idx === specRows.length - 1;
    drawCell(doc, startX, y, labelColWidth, rowH, label, { bold: true, labelFill: true, thickBottom: isLast });
    if (machineLogMode) {
      drawCell(doc, qtyX, y, QTY_COL_WIDTH, rowH, "", { specFill: true, thickBottom: isLast });
      drawCell(doc, machineX, y, MACHINE_COL_WIDTH, rowH, "", { specFill: true, thickBottom: isLast });
    }
    pagePoints.forEach((p, i) => {
      drawCell(doc, colX[i], y, colWidths[i], rowH, formatSpecValue(p, getter(p)), { bold: true, specFill: true, thickBottom: isLast });
    });
    if (machineLogMode) {
      drawCell(doc, commentX, y, COMMENT_COL_WIDTH, rowH, "", { specFill: true, thickBottom: isLast });
    }
    y += rowH;
  });

  samples.forEach((s, rowIndex) => {
    if (y + rowH > PAGE_BOTTOM) {
      y = newPage();
      drawColumnHeaderRow();
    }
    const sampleLabel = formatSampleLabel(s);
    const alt = rowIndex % 2 === 1;
    const sampleRow = sampleRowsByNumber?.[s];
    drawCell(doc, startX, y, labelColWidth, rowH, sampleLabel, { bold: true, labelFill: true });
    if (machineLogMode) {
      drawCell(doc, qtyX, y, QTY_COL_WIDTH, rowH, sampleRow?.qty != null ? String(sampleRow.qty) : "", { altFill: alt });
      drawCell(doc, machineX, y, MACHINE_COL_WIDTH, rowH, sampleRow?.machine_number || "", { altFill: alt });
    }
    pagePoints.forEach((p, i) => {
      const cell = grid[`${p.id}:${s}`];
      const outOfTolerance = Boolean(cell && cell.within_tolerance === 0);
      drawCell(doc, colX[i], y, colWidths[i], rowH, formatCellValue(p, cell?.measured_value), {
        danger: outOfTolerance,
        altFill: alt && !outOfTolerance,
      });
    });
    if (machineLogMode) {
      drawCell(doc, commentX, y, COMMENT_COL_WIDTH, rowH, sampleRow?.comment || "", { altFill: alt, align: "left" });
    }
    y += rowH;
  });

  doc.x = startX;
  doc.y = y + 10;
}

function drawCell(doc, x, y, w, h, text, opts = {}) {
  const {
    bold = false,
    danger = false,
    labelFill = false,
    specFill = false,
    altFill = false,
    thickBottom = false,
    align,
  } = opts;

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
  doc.text(text, x + 2, y + 4, { width: w - 4, height: h - 4, align: align ?? (labelFill ? "left" : "center") });
  doc.fillColor("#000");
}

function drawSignatureBlock(doc, inspection, pageWidth) {
  const startX = doc.page.margins.left;
  const y = doc.y + 24;
  const colWidth = (pageWidth - 60) / 2;

  const signedName = inspection.signature ? inspection.signature.full_name : null;
  // The Date line shows the header's inspection date; the exact signing
  // moment stays in the sheet's History (signatures table / audit log).
  const signedDate = inspection.signature ? formatDate(inspection.date) || "—" : null;

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
        is_reference: m.is_reference,
        is_check_column: m.is_check_column,
      });
    }
  });
  return [...map.values()].sort((a, b) => a.sort_order - b.sort_order);
}

function uniqueSamples(measurements) {
  return [...new Set(measurements.map((m) => m.sample_number))].sort((a, b) => a - b);
}

// Rows 1..sampling_plan_n print even when nothing's been measured yet, so
// the sheet can be printed blank and filled in on paper first -- a sample
// row otherwise only exists in the DB once a value is typed into it (see
// InspectionCapture.jsx's saveMeasurementsNow), so relying on `measurements`
// alone would print zero rows for a freshly-planned, still-empty sheet.
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

function buildGrid(measurements) {
  const grid = {};
  measurements.forEach((m) => {
    grid[`${m.balloon_point_id}:${m.sample_number}`] = m;
  });
  return grid;
}

// Mirrors frontend/src/lib/passfail.js -- kept separately since this is a
// plain Node file with no shared module boundary with the frontend build.
function isSpecless(point) {
  return !!point.is_check_column;
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
function drawSummaryTable(doc, summaryPoints, inspection, pageWidth, newPage) {
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

  let x;
  const drawColumnHeaderRow = () => {
    x = startX;
    cols.forEach((c) => {
      drawCell(doc, x, y, c.w, rowH, c.label, { bold: true, labelFill: c.key === "find" });
      x += c.w;
    });
    y += rowH;
  };
  if (y + rowH * 2 > PAGE_BOTTOM) y = newPage();
  drawColumnHeaderRow();

  rows.forEach(({ point, qtyInspected, qtyRejected, rejectNotes }, rowIndex) => {
    if (y + rowH > PAGE_BOTTOM) {
      y = newPage();
      drawColumnHeaderRow();
    }
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

module.exports = {
  generateInspectionPdf,
  // Shared with the Excel export so both render the same sheet.
  getSheetLayout,
  getMetaFields,
  getResult,
  summarizeCheckPoint,
  buildGrid,
  formatDate,
  formatSampleLabel,
  RESULT_LABELS,
  TYPE_TITLES,
  COMPANY,
  COLOR,
};
