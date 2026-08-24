const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png");
const PAGE_MARGIN = 30;

const COLOR = {
  primary: "#1f3864",
  accent: "#2e74b5",
  border: "#c7d2e0",
  specFill: "#eaf2fa",
  labelFill: "#eef1f6",
  altFill: "#fafbfc",
  failFill: "#fdecea",
  fail: "#c62828",
  ok: "#2e7d32",
  conditional: "#1d5fa8",
  warn: "#8a6d00",
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

// Two rows of three, matching the paper form's checkbox layout.
const TYPE_ROWS = [
  [
    ["quote", "Quote"],
    ["in_process", "In Proc"],
    ["setup", "1st Article"],
  ],
  [
    ["incoming", "Incoming"],
    ["final", "Final"],
    ["other", "Other"],
  ],
];

const TYPE_TITLES = {
  quote: "QUOTE INSPECTION DATA SHEET",
  incoming: "INCOMING INSPECTION DATA SHEET",
  setup: "SET-UP INSPECTION DATA SHEET",
  in_process: "IN-PROCESS INSPECTION DATA SHEET",
  final: "FINAL INSPECTION DATA SHEET",
  other: "INSPECTION DATA SHEET",
};

function generateInspectionPdf(res, inspection) {
  const doc = new PDFDocument({ size: "letter", layout: "landscape", margin: PAGE_MARGIN });
  doc.pipe(res);

  const points = inspection.points && inspection.points.length > 0
    ? inspection.points
    : uniquePoints(inspection.measurements);
  const samples = uniqueSamples(inspection.measurements);
  const grid = buildGrid(inspection.measurements);

  const pageWidth = doc.page.width - PAGE_MARGIN * 2;
  const labelColWidth = 70;
  const minColWidth = 42;
  const maxPointsPerPage = Math.max(1, Math.floor((pageWidth - labelColWidth) / minColWidth));

  const pages = chunk(points, maxPointsPerPage);
  const pointPages = pages.length ? pages : [[]];
  const totalPages = pointPages.length;

  pointPages.forEach((pagePoints, pageIndex) => {
    if (pageIndex > 0) doc.addPage();
    drawHeader(doc, inspection, pageIndex + 1, totalPages, pageWidth);
    drawGrid(doc, pagePoints, samples, grid, pageWidth, labelColWidth);
  });

  if (inspection.notes) {
    const notesX = doc.page.margins.left;
    const notesY = doc.y + 6;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text("Notes:", notesX, notesY, { continued: true });
    doc.font("Helvetica").text(` ${inspection.notes}`);
  }

  drawSignatureBlock(doc, inspection, pageWidth);

  doc.end();
}

function drawHeader(doc, inspection, pageNum, totalPages, pageWidth) {
  const startX = doc.page.margins.left;
  const topY = doc.page.margins.top;

  const logoBoxSize = 42;
  const companyX = startX + logoBoxSize + 10;
  const companyWidth = 230;
  const typeX = companyX + companyWidth + 6;
  const typeColWidth = 92;
  const typeBlockWidth = typeColWidth * 3;
  const sheetX = typeX + typeBlockWidth + 8;
  const sheetWidth = pageWidth - (sheetX - startX);

  let y = topY;

  if (fs.existsSync(LOGO_PATH)) {
    const pad = 5;
    doc.image(LOGO_PATH, startX + pad, y + pad, { fit: [logoBoxSize - pad * 2, logoBoxSize - pad * 2] });
  }

  doc.font("Helvetica-Bold").fontSize(13).fillColor(COLOR.primary).text(COMPANY.name, companyX, y, { width: companyWidth });
  doc
    .font("Helvetica-Bold")
    .fontSize(15)
    .fillColor(COLOR.primary)
    .text(TYPE_TITLES[inspection.type] ?? "INSPECTION DATA SHEET", typeX, y + 1, {
      width: typeBlockWidth + sheetWidth,
      height: 14,
      align: "center",
    });

  y += 14;
  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(COLOR.accent).text(COMPANY.tagline, companyX, y, { width: companyWidth });

  y += 11;
  doc.font("Helvetica").fontSize(7).fillColor("#555").text(COMPANY.addressLine1, companyX, y, { width: companyWidth });
  drawTypeRow(doc, typeX, y, typeColWidth, TYPE_ROWS[0], inspection.type);
  doc.font("Helvetica").fontSize(8).fillColor("#000").text("Sheet", sheetX, y);
  doc.font("Helvetica-Bold").fontSize(9).text(String(pageNum), sheetX + 34, y - 1);

  y += 13;
  doc.font("Helvetica").fontSize(7).fillColor("#555").text(COMPANY.addressLine2, companyX, y, { width: companyWidth });
  drawTypeRow(doc, typeX, y, typeColWidth, TYPE_ROWS[1], inspection.type);
  doc.font("Helvetica").fontSize(8).fillColor("#000").text("of", sheetX, y);
  doc.font("Helvetica-Bold").fontSize(9).text(String(totalPages), sheetX + 34, y - 1);

  y += 18;
  doc.moveTo(startX, y).lineTo(startX + pageWidth, y).lineWidth(1.5).strokeColor(COLOR.primary).stroke();
  y += 10;

  const rowH = 22;
  const resultBoxWidth = 130;
  const fieldsWidth = pageWidth - resultBoxWidth - 8;

  drawFieldRow(doc, startX, y, fieldsWidth, rowH, [
    ["Part #", inspection.part_number],
    ["Quantity", inspection.quantity],
    ["Customer", inspection.customer || inspection.client_name],
    ["Job# / WO#", inspection.job_number],
  ]);
  drawResultBox(doc, startX + fieldsWidth + 8, y, resultBoxWidth, rowH * 3 + 4, inspection);
  y += rowH;

  drawFieldRow(doc, startX, y, fieldsWidth, rowH, [
    ["Sampling Plan N", inspection.sampling_plan_n],
    ["Sampling Plan C", inspection.sampling_plan_c],
    ["By", inspection.signature ? inspection.signature.full_name : inspection.inspector],
    ["Date", inspection.signature ? formatDate(inspection.signature.signed_at) : formatDate(inspection.date)],
  ]);
  y += rowH;

  if (getResult(inspection) === "conditionally_approved") {
    drawFieldRow(doc, startX, y, fieldsWidth, rowH, [["Reason", inspection.conditional_reason]], 1);
    y += rowH;
  }
  y += 8;

  doc.x = startX;
  doc.y = y;
}

function formatDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

// PDFKit's standard fonts only support WinAnsi encoding, not Unicode, so a
// "✓"/"✗" character renders as a garbled glyph — draw them as vector
// strokes instead, positioned so the icon+label pair reads as centered.
function drawResultBox(doc, x, y, w, h, inspection) {
  const result = getResult(inspection);
  const bg =
    result === "approved" ? COLOR.ok
    : result === "conditionally_approved" ? COLOR.conditional
    : result === "rejected" ? COLOR.fail
    : "#fff3cd"; // in_progress
  const textColor = result === "in_progress" ? COLOR.warn : "#fff";
  const boxY = y + 11;
  const boxH = h - 13;

  doc.font("Helvetica").fontSize(6).fillColor("#555").text("RESULT", x + 3, y + 2);
  doc.roundedRect(x, boxY, w, boxH, 5).fill(bg);

  const label = RESULT_LABELS[result] ?? result.toUpperCase();
  const hasIcon = result === "approved" || result === "conditionally_approved" || result === "rejected";
  const iconSize = 10;
  const gap = 6;

  // "CONDITIONALLY APPROVED" is much longer than the other labels -- shrink
  // the font until it (plus the icon) fits the box instead of overflowing it.
  let fontSize = 13;
  doc.font("Helvetica-Bold").fontSize(fontSize);
  const maxWidth = w - 12 - (hasIcon ? iconSize + gap : 0);
  while (doc.widthOfString(label) > maxWidth && fontSize > 7) {
    fontSize -= 1;
    doc.fontSize(fontSize);
  }
  const labelWidth = doc.widthOfString(label);

  const totalWidth = labelWidth + (hasIcon ? iconSize + gap : 0);
  const iconX = x + (w - totalWidth) / 2;
  const textX = iconX + (hasIcon ? iconSize + gap : 0);
  const textY = boxY + boxH / 2 - fontSize / 2;

  if (hasIcon) {
    const iconY = boxY + boxH / 2 - iconSize / 2;
    doc.lineWidth(1.6).strokeColor(textColor).lineJoin("round").lineCap("round");
    if (result === "approved" || result === "conditionally_approved") {
      doc
        .moveTo(iconX, iconY + iconSize * 0.55)
        .lineTo(iconX + iconSize * 0.38, iconY + iconSize * 0.88)
        .lineTo(iconX + iconSize, iconY + iconSize * 0.12)
        .stroke();
    } else {
      doc.moveTo(iconX, iconY).lineTo(iconX + iconSize, iconY + iconSize).stroke();
      doc.moveTo(iconX + iconSize, iconY).lineTo(iconX, iconY + iconSize).stroke();
    }
  }

  doc.fillColor(textColor).text(label, textX, textY, { lineBreak: false });
  doc.fillColor("#000");
}

function drawTypeRow(doc, x, y, colWidth, entries, currentType) {
  entries.forEach(([typeKey, label], i) => {
    const cx = x + i * colWidth;
    const boxSize = 8;
    doc.rect(cx, y + 1, boxSize, boxSize).strokeColor("#000").stroke();
    if (currentType === typeKey) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#000").text("X", cx + 1, y);
    }
    doc.font("Helvetica").fontSize(8).fillColor("#000").text(label, cx + boxSize + 4, y);
  });
}

function drawFieldRow(doc, x, y, totalWidth, rowH, fields, colsOverride) {
  const colW = totalWidth / (colsOverride || fields.length);
  fields.forEach(([label, value], i) => {
    drawFieldBox(doc, x + i * colW, y, colW, rowH, label, value != null ? String(value) : "");
  });
}

function drawFieldBox(doc, x, y, w, h, label, value) {
  doc.rect(x, y, w, h).strokeColor(COLOR.border).stroke();
  doc.font("Helvetica-Bold").fontSize(6).fillColor("#8792a2").text(label.toUpperCase(), x + 4, y + 3, { width: w - 8 });
  doc
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .fillColor("#1a1a1a")
    .text(value, x + 4, y + 11, { width: w - 8, height: h - 13 });
}

function drawGrid(doc, pagePoints, samples, grid, pageWidth, labelColWidth) {
  const startX = doc.page.margins.left;
  let y = doc.y;
  const colW = pagePoints.length > 0 ? (pageWidth - labelColWidth) / pagePoints.length : pageWidth - labelColWidth;
  const rowH = 16;

  drawCell(doc, startX, y, labelColWidth, rowH, "Find #", { bold: true, headFill: true });
  pagePoints.forEach((p, i) => {
    drawCell(doc, startX + labelColWidth + i * colW, y, colW, rowH, String(p.balloon_number), { bold: true, headFill: true });
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
      drawCell(doc, startX + labelColWidth + i * colW, y, colW, rowH, text, { specFill: true, thickBottom: isLast });
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
  const { bold = false, danger = false, headFill = false, labelFill = false, specFill = false, altFill = false, thickBottom = false } = opts;

  let fill = null;
  if (headFill) fill = COLOR.primary;
  else if (danger) fill = COLOR.failFill;
  else if (specFill) fill = COLOR.specFill;
  else if (labelFill) fill = COLOR.labelFill;
  else if (altFill) fill = COLOR.altFill;

  if (fill) {
    doc.rect(x, y, w, h).fill(fill);
  }
  doc.rect(x, y, w, h).strokeColor(COLOR.border).stroke();
  if (thickBottom) {
    doc.moveTo(x, y + h).lineTo(x + w, y + h).lineWidth(1.5).strokeColor(COLOR.primary).stroke();
  }

  if (danger) {
    // Small triangular flag in the corner — a subtler complement to the red
    // text/fill rather than crowding the centered value.
    const flagSize = 5;
    doc
      .polygon([x + w - flagSize, y], [x + w, y], [x + w, y + flagSize])
      .fill(COLOR.fail);
  }

  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7);
  doc.fillColor(headFill ? "#fff" : danger ? COLOR.fail : "#1a1a1a");
  doc.text(text, x + 2, y + 4, { width: w - 4, height: h - 4, align: "center" });
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

module.exports = { generateInspectionPdf };
