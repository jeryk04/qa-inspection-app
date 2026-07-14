const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png");
const PAGE_MARGIN = 30;

// Matches the printed header on the company's paper Data Sheet.
const COMPANY = {
  name: "G&J Steel & Tubing, Inc",
  addressLine1: "406 Roycefield Road   Hillsborough, NJ 08844",
  addressLine2: "908-526-4445    Fax 908-526-9487",
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
    doc.font("Helvetica-Bold").fontSize(9).text("Notes:", notesX, notesY, { continued: true });
    doc.font("Helvetica").text(` ${inspection.notes}`);
  }

  doc.end();
}

function drawHeader(doc, inspection, pageNum, totalPages, pageWidth) {
  const startX = doc.page.margins.left;
  const topY = doc.page.margins.top;

  const logoW = 38;
  const logoH = 38;
  const companyX = startX + logoW + 8;
  const companyWidth = 220;
  const typeX = companyX + companyWidth + 6;
  const typeColWidth = 92;
  const typeBlockWidth = typeColWidth * 3;
  const sheetX = typeX + typeBlockWidth + 8;
  const sheetWidth = pageWidth - (sheetX - startX);

  let y = topY;

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, startX, y, { fit: [logoW, logoH] });
  }

  doc.font("Helvetica-Bold").fontSize(13).text(COMPANY.name, companyX, y, { width: companyWidth });
  doc
    .font("Helvetica-Bold")
    .fontSize(15)
    .text("DATA SHEET", typeX, y + 1, { width: typeBlockWidth + sheetWidth, height: 14, align: "center" });

  y += 15;
  doc.font("Helvetica").fontSize(7).text(COMPANY.addressLine1, companyX, y, { width: companyWidth });
  drawTypeRow(doc, typeX, y, typeColWidth, TYPE_ROWS[0], inspection.type);
  doc.font("Helvetica").fontSize(8).text("Sheet", sheetX, y);
  doc.font("Helvetica-Bold").fontSize(9).text(String(pageNum), sheetX + 34, y - 1);

  y += 13;
  doc.font("Helvetica").fontSize(7).text(COMPANY.addressLine2, companyX, y, { width: companyWidth });
  drawTypeRow(doc, typeX, y, typeColWidth, TYPE_ROWS[1], inspection.type);
  doc.font("Helvetica").fontSize(8).text("of", sheetX, y);
  doc.font("Helvetica-Bold").fontSize(9).text(String(totalPages), sheetX + 34, y - 1);

  y += 20;

  const rowH = 22;

  drawFieldRow(doc, startX, y, pageWidth, rowH, [
    ["Part #", inspection.part_number],
    ["Heat", inspection.heat],
    ["Quantity", inspection.quantity],
    ["Supplier", inspection.supplier],
    ["PO#", inspection.po_number],
  ]);
  y += rowH;

  drawFieldRow(doc, startX, y, pageWidth, rowH, [
    ["Operation", inspection.operation],
    ["Job#", inspection.job_number],
    ["Customer", inspection.customer || inspection.client_name],
    ["Customer PO#", inspection.customer_po_number],
  ]);
  y += rowH;

  const signedBy = inspection.signature
    ? `${inspection.signature.full_name} (${inspection.signature.action})`
    : inspection.inspector;
  const signedDate = inspection.signature ? inspection.signature.signed_at : inspection.date;

  drawFieldRow(doc, startX, y, pageWidth, rowH, [
    ["N:", inspection.sampling_plan_n],
    ["C:", inspection.sampling_plan_c],
    ["Lot Disposition", inspection.lot_disposition],
    ["By", signedBy],
    ["Date", signedDate],
  ]);
  y += rowH + 6;

  doc.x = startX;
  doc.y = y;
}

function drawTypeRow(doc, x, y, colWidth, entries, currentType) {
  entries.forEach(([typeKey, label], i) => {
    const cx = x + i * colWidth;
    const boxSize = 8;
    doc.rect(cx, y + 1, boxSize, boxSize).stroke();
    if (currentType === typeKey) {
      doc.font("Helvetica-Bold").fontSize(8).text("X", cx + 1, y);
    }
    doc.font("Helvetica").fontSize(8).text(label, cx + boxSize + 4, y);
  });
}

function drawFieldRow(doc, x, y, totalWidth, rowH, fields) {
  const colW = totalWidth / fields.length;
  fields.forEach(([label, value], i) => {
    drawFieldBox(doc, x + i * colW, y, colW, rowH, label, value != null ? String(value) : "");
  });
}

function drawFieldBox(doc, x, y, w, h, label, value) {
  doc.rect(x, y, w, h).stroke();
  doc.font("Helvetica").fontSize(6).fillColor("#555").text(label, x + 3, y + 2, { width: w - 6 });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#000")
    .text(value, x + 3, y + 10, { width: w - 6, height: h - 12 });
}

function drawGrid(doc, pagePoints, samples, grid, pageWidth, labelColWidth) {
  const startX = doc.page.margins.left;
  let y = doc.y;
  const colW = pagePoints.length > 0 ? (pageWidth - labelColWidth) / pagePoints.length : pageWidth - labelColWidth;
  const rowH = 16;

  drawCell(doc, startX, y, labelColWidth, rowH, "Find #", { bold: true });
  pagePoints.forEach((p, i) => {
    drawCell(doc, startX + labelColWidth + i * colW, y, colW, rowH, String(p.balloon_number), { bold: true });
  });
  y += rowH;

  const specRows = [
    ["Max. Spec.", (p) => p.max_spec],
    ["MEAN", (p) => p.mean_value],
    ["Min. Spec.", (p) => p.min_spec],
  ];
  specRows.forEach(([label, getter]) => {
    drawCell(doc, startX, y, labelColWidth, rowH, label, { bold: true });
    pagePoints.forEach((p, i) => {
      const v = getter(p);
      const text = v != null ? `${v}${p.unit || ""}` : "";
      drawCell(doc, startX + labelColWidth + i * colW, y, colW, rowH, text);
    });
    y += rowH;
  });

  samples.forEach((s) => {
    const sampleLabel = Number.isInteger(s) ? String(s) : s.toFixed(1);
    drawCell(doc, startX, y, labelColWidth, rowH, sampleLabel, { bold: true });
    pagePoints.forEach((p, i) => {
      const cell = grid[`${p.id}:${s}`];
      const text = cell && cell.measured_value != null ? String(cell.measured_value) : "";
      const outOfTolerance = Boolean(cell && cell.within_tolerance === 0);
      drawCell(doc, startX + labelColWidth + i * colW, y, colW, rowH, text, { danger: outOfTolerance });
    });
    y += rowH;
  });

  doc.x = startX;
  doc.y = y + 10;
}

function drawCell(doc, x, y, w, h, text, { bold = false, danger = false } = {}) {
  doc.rect(x, y, w, h).stroke();
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7);
  doc.fillColor(danger ? "#c62828" : "#000");
  doc.text(text, x + 2, y + 4, { width: w - 4, height: h - 4, align: "center" });
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
        unit: m.unit,
      });
    }
  });
  return [...map.values()].sort((a, b) => a.balloon_number - b.balloon_number);
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
