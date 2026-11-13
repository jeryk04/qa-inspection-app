const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const {
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
} = require("../pdf/inspectionSheet");

// The Data Sheet as an .xlsx, styled after the PDF: logo + company on the
// left, title + type chips on the right, a rule, then a light card of
// header fields with the Result in its own panel, the check-column tally,
// the Find# grid, and the signature lines. Content comes from the same
// getSheetLayout/getMetaFields as the PDF, laid out as one continuous
// worksheet instead of page-sized column groups. Readings and specs are
// written as real numbers (formatted to the column's decimal places) so the
// sheet can be re-used in Excel formulas; OK/NOT OK checks stay text.

const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png");

const argb = (hex) => `FF${hex.replace("#", "").toUpperCase()}`;
const fill = (hex) => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });
const thin = { style: "thin", color: { argb: argb(COLOR.border) } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const font = (opts) => ({ name: "Calibri", size: 10, color: { argb: argb(COLOR.text) }, ...opts });

// Sheet geometry, in Excel column-width units (~one Calibri 11 character).
// The header and the Find# grid share one set of columns, so widths are
// planned up front (planColumns) and the header is laid out on top of them.
const TARGET_WIDTH = 150; // roughly one landscape Letter page at fit-to-width
const MIN_COLS = 10; // enough column edges to lay the header card out on
const MIN_COL_CHARS = 7;
const MAX_COL_CHARS = 30;
const STRETCH_CAP = 18; // a column stretched to fill the page never grows past this
const RESULT_PANEL_CHARS = 26;

// Same pill labels/order as the PDF's TYPE_CHIPS.
const TYPE_CHIPS = [
  ["incoming", "Incoming"],
  ["setup", "Set Up"],
  ["in_process", "In Process"],
  ["final", "Final"],
  ["samples", "Samples"],
];

// Tinted versions of the PDF's result pill colors -- a merged cell fills
// the whole Result panel width, so a solid fill there reads as too heavy.
const RESULT_COLORS = {
  approved: [COLOR.okBg, COLOR.ok],
  conditionally_approved: [COLOR.conditionalBg, COLOR.conditional],
  rejected: [COLOR.failFill, COLOR.fail],
  in_progress: [COLOR.warnBg, COLOR.warn],
};

// e.g. 3 -> "0.000", 0 -> "0"; reference dimensions print in parentheses,
// same as formatSpecValue in the PDF.
function numberFormat(point, isSpec) {
  const dp = point.decimal_places ?? 3;
  const base = dp > 0 ? `0.${"0".repeat(dp)}` : "0";
  return isSpec && point.is_reference ? `\\(${base}\\)` : base;
}

function displayLength(point, value) {
  if (value == null || value === "") return 0;
  return typeof value === "number" ? value.toFixed(point.decimal_places ?? 3).length + (point.is_reference ? 2 : 0) : String(value).length;
}

function metaText(value) {
  return value != null && value !== "" ? String(value) : "—";
}

// A plain whole number held as text (Find# "3", PO# "96664") is written as a
// real number so Excel doesn't flag every such cell with its green "number
// stored as text" triangle. Leading zeros, decimals or any other characters
// keep it text, so an identifier like "0123" is never altered.
function asCellValue(value) {
  return typeof value === "string" && /^(0|[1-9]\d{0,14})$/.test(value) ? Number(value) : value;
}

// Excel sheet names: max 31 chars, none of []:*?/\
function sheetName(text) {
  return text.replace(/[[\]:*?/\\]/g, "-").slice(0, 31);
}

// Column widths for the whole sheet: each column fits its widest grid/tally
// text, then -- like the PDF sharing leftover page width across its columns
// -- every column but the label one is stretched evenly (up to STRETCH_CAP)
// toward TARGET_WIDTH, so the header card and grid span a full page. Always
// at least MIN_COLS columns, even for a sheet with only a column or two.
function planColumns(inspection, layout, summaryRows) {
  const { points, gridSamples, machineLogMode, sampleRowsByNumber } = layout;
  const grid = buildGrid(inspection.measurements);
  const firstPointCol = machineLogMode ? 4 : 2;
  const commentCol = firstPointCol + points.length;
  const need = [];
  const widen = (col, len) => {
    need[col] = Math.max(need[col] || 0, len);
  };

  ["Find #", "Max. Spec.", "Min. Spec."].forEach((l) => widen(1, l.length));
  gridSamples.forEach((s) => widen(1, formatSampleLabel(s).length));
  if (machineLogMode && points.length > 0) {
    widen(2, "Qty".length);
    widen(3, "Machine #".length);
    widen(commentCol, "Comment".length);
    gridSamples.forEach((s) => {
      const row = sampleRowsByNumber[s];
      widen(2, String(row?.qty ?? "").length);
      widen(3, String(row?.machine_number ?? "").length);
      widen(commentCol, Math.min(40, (row?.comment || "").length));
    });
  }
  points.forEach((p, i) => {
    const c = firstPointCol + i;
    widen(c, String(p.balloon_number).length);
    [p.max_spec, p.mean_value, p.min_spec].forEach((v) => widen(c, displayLength(p, v)));
    gridSamples.forEach((s) => widen(c, displayLength(p, grid[`${p.id}:${s}`]?.measured_value)));
  });
  if (summaryRows.length > 0) {
    const hasAnyReject = summaryRows.some((row) => row.qtyRejected > 0);
    summaryRows.forEach((row) => widen(1, String(row.point.balloon_number).length));
    // "Qty Inspected" / "Qty Rejected" headers wrap onto two lines.
    widen(2, "Inspected".length);
    widen(3, "Rejected".length);
    if (hasAnyReject) widen(4, Math.min(40, Math.max(...summaryRows.map((row) => (row.rejectNotes || "").length))));
    widen(hasAnyReject ? 5 : 4, "10 REJECTED".length);
  }

  const gridLastCol = points.length > 0 ? (machineLogMode ? commentCol : commentCol - 1) : 1;
  const lastCol = Math.max(gridLastCol, need.length - 1, MIN_COLS);
  const widths = [];
  for (let c = 1; c <= lastCol; c++) {
    widths[c] = Math.min(MAX_COL_CHARS, Math.max(c === 1 ? 11 : MIN_COL_CHARS, (need[c] || 0) + 3));
  }

  let extra = TARGET_WIDTH - widths.slice(1).reduce((a, b) => a + b, 0);
  let open = widths.map((w, c) => c).filter((c) => c >= 2 && widths[c] < STRETCH_CAP);
  while (extra > 0.5 && open.length > 0) {
    const share = extra / open.length;
    for (const c of open) {
      const add = Math.min(share, STRETCH_CAP - widths[c]);
      widths[c] += add;
      extra -= add;
    }
    open = open.filter((c) => widths[c] < STRETCH_CAP - 0.01);
  }

  return { firstPointCol, commentCol, lastCol, widths };
}

// Left edge of each field slot in the header card: slots are as wide as
// their widest label/value plus an even share of the leftover width (same
// rule as the PDF's meta grid), snapped to the nearest column edge.
function placeFieldSlots(fields, widths, firstCol, endCol) {
  const k = Math.ceil(fields.length / 2);
  const needs = Array.from({ length: k }, (_, j) =>
    // Uppercase captions and bold 11pt values both run wider than plain
    // Calibri 11 characters; +3 covers the indent and a gap before the next slot.
    Math.max(...[fields[j], fields[j + k]].filter(Boolean).map(([label, value]) => Math.max(String(label).length * 1.1, metaText(value).length * 1.3))) + 3
  );
  const avail = widths.slice(firstCol, endCol).reduce((a, b) => a + b, 0);
  const extra = Math.max(0, (avail - needs.reduce((a, b) => a + b, 0)) / k);
  const leftEdge = (c) => widths.slice(firstCol, c).reduce((a, b) => a + b, 0);

  const starts = [firstCol];
  let target = 0;
  for (let j = 1; j < k; j++) {
    target += needs[j - 1] + extra;
    // Leave at least one column for every slot still to come.
    const lastAllowed = endCol - (k - j);
    // Never snap so far left that the previous slot is narrower than its text.
    let earliest = starts[j - 1] + 1;
    while (earliest < lastAllowed && leftEdge(earliest) - leftEdge(starts[j - 1]) < needs[j - 1]) earliest++;
    let best = earliest;
    for (let c = earliest; c <= lastAllowed; c++) {
      if (Math.abs(leftEdge(c) - target) < Math.abs(leftEdge(best) - target)) best = c;
    }
    starts.push(best);
    target = Math.max(target, leftEdge(best));
  }
  return starts;
}

function addReportSheet(workbook, inspection, name, logoId) {
  const ws = workbook.addWorksheet(sheetName(name), {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 1, // Letter, same as the PDF
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 },
    },
    // "Sheet X of Y" top right, where the PDF stamps it.
    headerFooter: { oddHeader: "&R&8Sheet &P of &N" },
  });

  const layout = getSheetLayout(inspection);
  const { summaryPoints, points, gridSamples, machineLogMode, sampleRowsByNumber } = layout;
  const summaryRows = summaryPoints.map((p) => ({ point: p, ...summarizeCheckPoint(p, inspection) }));
  const { firstPointCol, commentCol, lastCol, widths } = planColumns(inspection, layout, summaryRows);
  for (let c = 1; c <= lastCol; c++) ws.getColumn(c).width = widths[c];

  const grid = buildGrid(inspection.measurements);
  const result = getResult(inspection);

  const put = (row, col, value, style = {}) => {
    const cell = ws.getCell(row, col);
    cell.value = asCellValue(value);
    // "0" keeps a long converted identifier (e.g. an 11+ digit Part #) from
    // displaying in scientific notation.
    if (cell.value !== value && style.numFmt === undefined) cell.numFmt = "0";
    for (const [key, v] of Object.entries(style)) if (v !== undefined) cell[key] = v;
    return cell;
  };
  // Merged cells share the first cell's style in exceljs, so style it first.
  const putMerged = (row, fromCol, toCol, value, style = {}, toRow = row) => {
    const cell = put(row, fromCol, value, style);
    if (toCol > fromCol || toRow > row) ws.mergeCells(row, fromCol, toRow, toCol);
    return cell;
  };
  const height = (row, pt) => {
    ws.getRow(row).height = pt;
  };

  // --- Logo, company, title, type chips ---------------------------------
  if (logoId != null) {
    // Portrait logo, fit into the top-left corner like the PDF's logo box.
    ws.addImage(logoId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 38, height: 57 }, editAs: "oneCell" });
  }
  height(1, 22);
  height(2, 14);
  height(3, 13);
  height(4, 13);
  put(1, 2, COMPANY.name, { font: font({ bold: true, size: 14, color: { argb: argb(COLOR.primary) } }), alignment: { vertical: "middle" } });
  put(2, 2, COMPANY.tagline, { font: font({ italic: true, size: 9, color: { argb: argb(COLOR.accent) } }) });
  put(3, 2, COMPANY.addressLine1, { font: font({ size: 8, color: { argb: "FF555555" } }) });
  put(4, 2, COMPANY.addressLine2, { font: font({ size: 8, color: { argb: "FF555555" } }) });
  // Right-aligned in the last column, so the text runs leftward over the
  // empty cells beside it.
  put(1, lastCol, TYPE_TITLES[inspection.type] ?? "INSPECTION DATA SHEET", {
    font: font({ bold: true, size: 15, color: { argb: argb(COLOR.primary) } }),
    alignment: { horizontal: "right", vertical: "middle" },
  });
  put(3, lastCol, {
    richText: TYPE_CHIPS.flatMap(([key, label], i) => [
      ...(i > 0 ? [{ text: "     ", font: font({ size: 9 }) }] : []),
      key === inspection.type
        ? { text: label, font: font({ bold: true, size: 9, color: { argb: argb(COLOR.accent) }, underline: true }) }
        : { text: label, font: font({ size: 9, color: { argb: "FF9AA3AF" } }) },
    ]),
  }, { alignment: { horizontal: "right", vertical: "middle" } });
  // The dark rule under the header.
  height(5, 6);
  for (let c = 1; c <= lastCol; c++) {
    ws.getCell(5, c).border = { bottom: { style: "medium", color: { argb: argb(COLOR.primary) } } };
  }
  let r = 7;
  height(6, 10);

  // --- Header card: two rows of label/value fields + the Result panel ----
  const fields = getMetaFields(inspection, formatDate(inspection.date));
  const k = Math.ceil(fields.length / 2);
  let resultStart = lastCol;
  while (resultStart > k + 1 && widths.slice(resultStart, lastCol + 1).reduce((a, b) => a + b, 0) < RESULT_PANEL_CHARS) {
    resultStart--;
  }
  const slots = placeFieldSlots(fields, widths, 1, resultStart);
  const slotEnd = (j) => (j + 1 < slots.length ? slots[j + 1] - 1 : resultStart - 1);

  const isConditional = result === "conditionally_approved";
  const cardTop = r;
  // Row plan: pad, label, value, gap, label, value, [gap, label, value], pad
  const rowsPlan = [5, 12, 19, 6, 12, 19, ...(isConditional ? [6, 12, 19] : []), 6];
  const cardBottom = cardTop + rowsPlan.length - 1;
  rowsPlan.forEach((h, i) => height(cardTop + i, h));
  for (let row = cardTop; row <= cardBottom; row++) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(row, c);
      cell.fill = fill(COLOR.bg);
      cell.border = {
        ...(row === cardTop ? { top: thin } : {}),
        ...(row === cardBottom ? { bottom: thin } : {}),
        ...(c === 1 ? { left: thin } : {}),
        ...(c === lastCol ? { right: thin } : {}),
        // The Result panel's divider.
        ...(c === resultStart && row > cardTop && row < cardBottom ? { left: thin } : {}),
      };
    }
  }

  const labelFont = font({ bold: true, size: 7.5, color: { argb: argb(COLOR.labelMuted) } });
  const valueFont = font({ bold: true, size: 11 });
  const drawField = (labelRow, j, label, value) => {
    const from = slots[j];
    const to = slotEnd(j);
    const edge = from === 1 ? { left: thin } : {};
    putMerged(labelRow, from, to, String(label).toUpperCase(), {
      font: labelFont,
      fill: fill(COLOR.bg),
      border: edge,
      alignment: { vertical: "bottom", horizontal: "left", indent: 1 },
    });
    putMerged(labelRow + 1, from, to, metaText(value), {
      font: valueFont,
      fill: fill(COLOR.bg),
      border: edge,
      alignment: { vertical: "top", horizontal: "left", indent: 1 },
    });
  };
  fields.forEach(([label, value], i) => drawField(i < k ? cardTop + 1 : cardTop + 4, i % k, label, value));
  if (isConditional) {
    putMerged(cardTop + 7, 1, resultStart - 1, "REASON", {
      font: labelFont,
      fill: fill(COLOR.bg),
      border: { left: thin },
      alignment: { vertical: "bottom", horizontal: "left", indent: 1 },
    });
    putMerged(cardTop + 8, 1, resultStart - 1, metaText(inspection.conditional_reason), {
      font: valueFont,
      fill: fill(COLOR.bg),
      border: { left: thin },
      alignment: { vertical: "top", horizontal: "left", indent: 1, wrapText: true },
    });
  }

  const panelBorder = { left: thin, ...(lastCol >= resultStart ? { right: thin } : {}) };
  putMerged(cardTop + 2, resultStart, lastCol, "RESULT", {
    font: labelFont,
    fill: fill(COLOR.bg),
    border: panelBorder,
    alignment: { horizontal: "center", vertical: "bottom" },
  });
  const [badgeBg, badgeText] = RESULT_COLORS[result] ?? RESULT_COLORS.in_progress;
  putMerged(cardTop + 3, resultStart, lastCol, RESULT_LABELS[result] ?? String(result).toUpperCase(), {
    font: font({ bold: true, size: 11, color: { argb: argb(badgeText) } }),
    fill: fill(badgeBg),
    border: panelBorder,
    alignment: { horizontal: "center", vertical: "middle" },
  }, cardTop + 4);

  r = cardBottom + 2;

  // --- Check-column tally (same rule as the PDF's drawSummaryTable) --------
  if (summaryRows.length > 0) {
    const hasAnyReject = summaryRows.some((row) => row.qtyRejected > 0);
    const headers = ["Find #", "Qty Inspected", "Qty Rejected", ...(hasAnyReject ? ["Reject Notes"] : []), "Result"];
    headers.forEach((h, i) => {
      put(r, i + 1, h, {
        font: font({ bold: true, size: 9 }),
        fill: fill(i === 0 ? COLOR.labelColBg : COLOR.tableHeaderBg),
        border: BOX,
        alignment: { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true },
      });
    });
    height(r, 26);
    r++;
    summaryRows.forEach(({ point, qtyInspected, qtyRejected, rejectNotes }, rowIndex) => {
      const rejected = qtyRejected > 0;
      const values = [
        String(point.balloon_number),
        qtyInspected,
        qtyRejected,
        ...(hasAnyReject ? [rejectNotes || "—"] : []),
        rejected ? `${qtyRejected} REJECTED` : "APPROVED",
      ];
      values.forEach((v, i) => {
        const isResult = i === values.length - 1;
        put(r, i + 1, v, {
          border: BOX,
          fill: i === 0 ? fill(COLOR.labelColBg) : rowIndex % 2 === 1 ? fill(COLOR.altFill) : undefined,
          font: isResult
            ? font({ bold: true, color: { argb: argb(rejected ? COLOR.fail : COLOR.ok) } })
            : font({ bold: i === 0 }),
          alignment: { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: i === 3 && hasAnyReject },
        });
      });
      r++;
    });
    r++;
  }

  // --- Find# grid ------------------------------------------------------------
  if (points.length > 0) {
    const labelCell = { font: font({ bold: true }), fill: fill(COLOR.labelColBg), border: BOX, alignment: { horizontal: "left", vertical: "middle" } };
    put(r, 1, "Find #", labelCell);
    if (machineLogMode) {
      put(r, 2, "Qty", { ...labelCell, alignment: { horizontal: "center", vertical: "middle" } });
      put(r, 3, "Machine #", { ...labelCell, alignment: { horizontal: "center", vertical: "middle" } });
    }
    points.forEach((p, i) => {
      put(r, firstPointCol + i, String(p.balloon_number), {
        font: font({ bold: true }),
        border: BOX,
        alignment: { horizontal: "center", vertical: "middle" },
      });
    });
    if (machineLogMode) put(r, commentCol, "Comment", labelCell);
    height(r, 17);
    // Repeat the Find# header row on every printed page.
    ws.pageSetup.printTitlesRow = `${r}:${r}`;
    r++;

    // Same as the PDF: a sheet with no spec values at all skips the three
    // empty spec rows.
    const hasAnySpec = points.some((p) => p.max_spec != null || p.min_spec != null || p.mean_value != null);
    const specRows = hasAnySpec
      ? [["Max. Spec.", (p) => p.max_spec], ["MEAN", (p) => p.mean_value], ["Min. Spec.", (p) => p.min_spec]]
      : [];
    specRows.forEach(([label, get], idx) => {
      const border =
        idx === specRows.length - 1 ? { ...BOX, bottom: { style: "medium", color: { argb: argb(COLOR.primary) } } } : BOX;
      put(r, 1, label, { ...labelCell, border });
      const blank = (col) => put(r, col, null, { fill: fill(COLOR.bg), border });
      if (machineLogMode) [2, 3, commentCol].forEach(blank);
      points.forEach((p, i) => {
        const v = get(p);
        put(r, firstPointCol + i, v ?? null, {
          numFmt: numberFormat(p, true),
          font: font({ bold: true }),
          fill: fill(COLOR.bg),
          border,
          alignment: { horizontal: "center", vertical: "middle" },
        });
      });
      height(r, 17);
      r++;
    });

    gridSamples.forEach((s, rowIndex) => {
      const alt = rowIndex % 2 === 1 ? fill(COLOR.altFill) : undefined;
      put(r, 1, s, { ...labelCell, numFmt: Number.isInteger(s) ? "0" : "0.0" });
      if (machineLogMode) {
        const row = sampleRowsByNumber[s];
        put(r, 2, row?.qty ?? null, { font: font(), fill: alt, border: BOX, alignment: { horizontal: "center", vertical: "middle" } });
        put(r, 3, row?.machine_number || null, { font: font(), fill: alt, border: BOX, alignment: { horizontal: "center", vertical: "middle" } });
        put(r, commentCol, row?.comment || null, { font: font(), fill: alt, border: BOX, alignment: { horizontal: "left", vertical: "middle", wrapText: true } });
      }
      points.forEach((p, i) => {
        const cell = grid[`${p.id}:${s}`];
        const v = cell?.measured_value;
        const out = Boolean(cell && cell.within_tolerance === 0);
        put(r, firstPointCol + i, v == null || v === "" ? null : v, {
          numFmt: typeof v === "number" ? numberFormat(p, false) : undefined,
          border: BOX,
          alignment: { horizontal: "center", vertical: "middle" },
          font: out ? font({ bold: true, color: { argb: argb(COLOR.fail) } }) : font(),
          fill: out ? fill(COLOR.failFill) : alt,
        });
      });
      height(r, 16);
      r++;
    });
  }

  // --- Notes + signature lines ---------------------------------------------
  if (inspection.notes) {
    r++;
    putMerged(r, 1, lastCol, {
      richText: [
        { text: "Notes: ", font: font({ bold: true, size: 9 }) },
        { text: inspection.notes, font: font({ size: 9 }) },
      ],
    }, { alignment: { horizontal: "left", vertical: "top", wrapText: true } });
    height(r, 14 * Math.max(1, Math.ceil((inspection.notes.length + 7) / (TARGET_WIDTH * 1.1))));
  }

  // Two lines like the PDF: Inspector signature on the left half, Date on
  // the right, with a gap between them.
  const total = widths.slice(1).reduce((a, b) => a + b, 0);
  const edgeNear = (fraction) => {
    let acc = 0;
    for (let c = 1; c <= lastCol; c++) {
      if (acc + widths[c] / 2 >= total * fraction) return c;
      acc += widths[c];
    }
    return lastCol;
  };
  const leftEnd = Math.max(1, edgeNear(0.45) - 1);
  const rightStart = Math.min(lastCol, Math.max(leftEnd + 2, edgeNear(0.55)));
  const signedName = inspection.signature ? inspection.signature.full_name : null;
  const lineBorder = { bottom: { style: "thin", color: { argb: "FF1A1A1A" } } };
  r += 2;
  height(r, 26);
  putMerged(r, 1, leftEnd, signedName || "", {
    font: font({ italic: true, size: 16, color: { argb: "FF1A1A1A" } }),
    border: lineBorder,
    alignment: { horizontal: "center", vertical: "bottom" },
  });
  putMerged(r, rightStart, lastCol, signedName ? formatDate(inspection.date) || "—" : "", {
    font: font({ bold: true, size: 11, color: { argb: "FF1A1A1A" } }),
    border: lineBorder,
    alignment: { horizontal: "center", vertical: "bottom" },
  });
  r++;
  const caption = { font: font({ size: 8, color: { argb: "FF666666" } }), alignment: { horizontal: "center", vertical: "top" } };
  putMerged(r, 1, leftEnd, signedName ? "Inspector signature · electronically signed" : "Inspector signature", caption);
  putMerged(r, rightStart, lastCol, "Date", caption);

  return ws;
}

const SHEET_TAB_NAMES = {
  incoming: "Incoming Inspection",
  setup: "Set-up Inspection",
  in_process: "In-Process Inspection",
  final: "Final Inspection",
  samples: "Samples Inspection",
};

// Writes the workbook to `res` (any writable stream). A Final Inspection
// bundled with its Operator In-Process sheets (see linkedInProcesses in
// getInspectionDetail) gets one extra tab per operation, same as the PDF
// appends each as its own section.
async function generateInspectionXlsx(res, inspection) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY.name;
  workbook.created = new Date();
  const logoId = fs.existsSync(LOGO_PATH) ? workbook.addImage({ filename: LOGO_PATH, extension: "png" }) : null;
  addReportSheet(workbook, inspection, SHEET_TAB_NAMES[inspection.type] ?? "Inspection", logoId);
  // Tab names must be unique -- named by operation ("Op - Bending"), with a
  // counter only if two operations would truncate/sanitize to the same name.
  const usedNames = new Set(workbook.worksheets.map((ws) => ws.name.toLowerCase()));
  (inspection.linkedInProcesses || []).forEach((linked) => {
    const base = sheetName(linked.operation_name ? `Op - ${linked.operation_name}` : "Operator In-Process");
    let name = base;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = sheetName(`${base.slice(0, 26)} (${n})`);
    usedNames.add(name.toLowerCase());
    addReportSheet(workbook, linked, name, logoId);
  });
  await workbook.xlsx.write(res);
}

module.exports = { generateInspectionXlsx };
