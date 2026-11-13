const { getSheetLayout, buildGrid, summarizeCheckPoint, formatSampleLabel } = require("../pdf/inspectionSheet");

// Automatic "possible inspector error" checks for one Data Sheet, shown on
// the QA Manager's Inspector Performance page. Each is a pointer for a
// human to go look at the sheet, not a verdict -- e.g. approving with an
// out-of-tolerance reading can be legitimate, but it's worth a second look.
//
//   error   -- the sheet contradicts itself or likely holds a wrong value
//   warning -- incomplete or needed correcting
//   info    -- context only; doesn't make the sheet "flagged"
//
// `inspection` is getInspectionDetail()'s shape; `audit` is
// { unlocks, otherEditors: [names] } from the audit log; `today` is the
// local YYYY-MM-DD the check runs on.

const STALE_DAYS = 3;
const EXAMPLES = 3;

function isNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function fmt(point, v) {
  return isNumber(v) ? v.toFixed(point.decimal_places ?? 3) : String(v);
}

function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

function withExamples(count, examples, noun) {
  const shown = examples.slice(0, EXAMPLES).join("; ");
  const more = count > EXAMPLES ? ` (+${count - EXAMPLES} more)` : "";
  return `${count} ${noun}${count === 1 ? "" : "s"}: ${shown}${more}`;
}

function flagSheet(inspection, audit, today) {
  const flags = [];
  const signed = inspection.status === "approved" || inspection.status === "rejected";
  const { points, gridSamples, summaryPoints } = getSheetLayout(inspection);
  const grid = buildGrid(inspection.measurements);
  const pointsById = new Map((inspection.points || []).map((p) => [p.id, p]));

  // Likely typo: a reading so far outside its tolerance band (more than two
  // band-widths past a limit), or one that lands in spec once its decimal
  // point is shifted -- e.g. 77.03 on a 7.770–8.070 dimension.
  const typos = [];
  for (const m of inspection.measurements) {
    const p = pointsById.get(m.balloon_point_id) || m;
    const v = m.measured_value;
    if (!isNumber(v) || p.is_check_column || !isNumber(p.min_spec) || !isNumber(p.max_spec)) continue;
    const band = p.max_spec - p.min_spec;
    if (!(band > 0) || (v >= p.min_spec && v <= p.max_spec)) continue;
    const inSpec = (x) => x >= p.min_spec && x <= p.max_spec;
    const farOut = v < p.min_spec - 2 * band || v > p.max_spec + 2 * band;
    if (farOut || inSpec(v * 10) || inSpec(v / 10)) {
      typos.push(
        `Find# ${p.balloon_number} sample ${formatSampleLabel(m.sample_number)} = ${fmt(p, v)} (spec ${fmt(p, p.min_spec)}–${fmt(p, p.max_spec)})`
      );
    }
  }
  if (typos.length > 0) {
    flags.push({ code: "likely_typo", severity: "error", label: "Possible typo", detail: withExamples(typos.length, typos, "reading") });
  }

  // Out-of-tolerance readings or rejected check-column pieces on the sheet.
  const failingSamples = new Set(
    inspection.measurements.filter((m) => m.within_tolerance === 0).map((m) => m.sample_number)
  );
  const summaryRejected = summaryPoints.reduce((n, p) => n + (summarizeCheckPoint(p, inspection).qtyRejected || 0), 0);
  const hasFailures = failingSamples.size > 0 || summaryRejected > 0;
  const conditional = !!(inspection.conditional_reason && inspection.conditional_reason.trim());

  if (inspection.status === "approved" && !conditional && hasFailures) {
    flags.push({
      code: "approved_with_failures",
      severity: "error",
      label: "Approved with failures",
      detail: `Signed as Approved (not Conditionally Approved) with ${failingSamples.size || summaryRejected} failing sample(s) on the sheet.`,
    });
  }

  // The header's Total Rejected contradicting the readings -- only the
  // clear-cut cases, since how a sheet counts rejects across several checks
  // isn't uniform: a Rejected sheet saying 0 rejected, or any signed sheet
  // claiming rejects when nothing failed. (A conditionally approved lot
  // legitimately says 0 -- it was accepted -- and an Approved one with
  // failures is already "Approved with failures" above.)
  const statedRejected = Number(inspection.sampling_plan_c);
  if (signed && inspection.sampling_plan_c != null && inspection.sampling_plan_c !== "" && Number.isFinite(statedRejected)) {
    if (statedRejected === 0 && hasFailures && inspection.status === "rejected") {
      flags.push({
        code: "rejected_count_mismatch",
        severity: "error",
        label: "Total Rejected doesn't match",
        detail: `Header says 0 rejected, but ${failingSamples.size || summaryRejected} sample(s) failed.`,
      });
    } else if (statedRejected > 0 && !hasFailures) {
      flags.push({
        code: "rejected_count_mismatch",
        severity: "error",
        label: "Total Rejected doesn't match",
        detail: `Header says ${statedRejected} rejected, but no reading is out of tolerance.`,
      });
    }
  }

  // Empty cells left on a signed sheet (gridded columns × the rows the sheet
  // prints, including planned sample rows never filled in).
  if (signed) {
    const blanks = [];
    for (const p of points) {
      const missing = gridSamples.filter((s) => {
        const v = grid[`${p.id}:${s}`]?.measured_value;
        return v == null || v === "";
      });
      if (missing.length > 0) {
        const which = missing.length === gridSamples.length ? "all samples" : `sample ${missing.map(formatSampleLabel).join(", ")}`;
        blanks.push({ n: missing.length, text: `Find# ${p.balloon_number}: ${which}` });
      }
    }
    const total = blanks.reduce((n, b) => n + b.n, 0);
    if (total > 0) {
      const shown = blanks.slice(0, EXAMPLES).map((b) => b.text).join("; ");
      const more = blanks.length > EXAMPLES ? ` (+${blanks.length - EXAMPLES} more columns)` : "";
      flags.push({
        code: "blank_cells",
        severity: "warning",
        label: "Empty cells",
        detail: `${total} empty cell${total === 1 ? "" : "s"} on a signed sheet — ${shown}${more}`,
      });
    }
  }

  if (audit.unlocks > 0) {
    flags.push({
      code: "reopened",
      severity: "warning",
      label: "Reopened after signing",
      detail: `Unlocked for correction ${audit.unlocks} time${audit.unlocks === 1 ? "" : "s"} after it was signed.`,
    });
  }

  const day = String(inspection.date || "").slice(0, 10);
  if (inspection.status === "in_progress" && day && daysBetween(day, today) > STALE_DAYS) {
    flags.push({
      code: "stale",
      severity: "warning",
      label: "Not finished",
      detail: `Still in progress ${daysBetween(day, today)} days after the inspection date.`,
    });
  }

  if (audit.otherEditors.length > 0) {
    flags.push({
      code: "edited_by_others",
      severity: "info",
      label: "Edited by others",
      detail: `Also changed by ${audit.otherEditors.join(", ")}.`,
    });
  }

  return flags;
}

function isFlagged(flags) {
  return flags.some((f) => f.severity === "error" || f.severity === "warning");
}

module.exports = { flagSheet, isFlagged };
