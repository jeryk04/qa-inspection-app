import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { toStoredNumber } from "../lib/numeric";
import { resultLabel, resultStatus, timeAgo } from "../lib/format";
import { formatPassFail, isSpecless, parsePassFail, summarizeCheckPoint } from "../lib/passfail";
import DecimalCell from "../components/DecimalCell";
import PassFailCell from "../components/PassFailCell";
import { useConfirm } from "../hooks/useConfirm";

const BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001/api`;
const AUTOSAVE_DELAY_MS = 900;
// Past this many sample rows, the on-screen grid collapses into a summary
// line by default (e.g. a 100% inspection of 112 pieces) -- printing/PDF
// export is unaffected, this is purely about not scrolling through a huge
// grid while filling it out.
const SAMPLE_COLLAPSE_THRESHOLD = 10;

// Header fields for Final/Set-up/In-Process -- organized by real customer,
// tracked by the shop's own Job#/WO#.
const HEADER_FIELDS = [
  ["quantity", "Quantity"],
  ["customer", "Customer"],
  ["job_number", "Job# / WO#"],
  ["date", "Date"],
  ["sampling_plan_n", "Sampling Plan  n="],
  ["sampling_plan_c", "c="],
  ["inspector", "By (Inspector)"],
];

// Incoming Inspection's paper header is different -- material arrives FROM a
// supplier, referenced by their PO# (not a shop Job#/WO#) and heat number
// (raw-material lot traceability), not organized by customer at all. Same
// `supplier`/`po_number`/`heat` columns HEADER_FIELDS' comment already
// pointed at, now actually wired up.
const INCOMING_HEADER_FIELDS = [
  ["quantity", "Quantity"],
  ["supplier", "Supplier"],
  ["po_number", "PO#"],
  ["heat", "Heat #"],
  ["date", "Date"],
  ["sampling_plan_n", "Sampling Plan  n="],
  ["sampling_plan_c", "c="],
  ["inspector", "By (Inspector)"],
];

// Final Inspection is the last stop in Set-up -> In-Process -> Final, so it's
// the only type that can gate on In-Process having already happened -- see
// the matching OPERATOR_ALLOWED_CLIENTS-style check on PUT /:id/status.
const FINAL_HEADER_FIELDS = [...HEADER_FIELDS, ["requires_in_process", "Operator In-Process Data Sheet required"]];

function headerFieldsFor(type) {
  if (type === "incoming") return INCOMING_HEADER_FIELDS;
  if (type === "final") return FINAL_HEADER_FIELDS;
  return HEADER_FIELDS;
}

// Header fields that render as a checkbox and are stored as a 0/1 column on
// the backend (see the matching list in backend/src/routes/inspections.js).
// hundred_percent_inspection isn't here -- it's set once at Data Sheet
// Template setup (DataSheetTemplate.jsx) and inherited at creation, not
// edited per-inspection, so it's read straight off `inspection` instead of
// living in this editable header-fields system at all.
const BOOLEAN_HEADER_FIELDS = ["requires_in_process"];

const ACTION_LABELS = {
  created: "Created",
  header_updated: "Header updated",
  measurements_saved: "Measurements saved",
  sample_deleted: "Sample deleted",
  status_changed: "Status changed",
  signed_approved: "Signed — Approved",
  signed_rejected: "Signed — Rejected",
};

// Dot color in the History timeline -- the two signing outcomes get their
// result color, everything else is a neutral routine-edit tone.
function auditTone(action) {
  if (action === "signed_approved") return "ok";
  if (action === "signed_rejected") return "fail";
  return "neutral";
}

function cellKey(pointId, sampleNumber) {
  return `${pointId}:${sampleNumber}`;
}

// Live out-of-tolerance check against the point's CURRENT spec — used while
// the sheet is still editable, so correcting a spec on the Data Sheet
// Template immediately re-flags cells here instead of showing whatever was
// computed at the last save.
function isOutOfTolerance(point, rawValue) {
  const num = toStoredNumber(rawValue);
  if (num == null || Number.isNaN(num)) return false;
  if (point.max_spec != null && num > point.max_spec) return true;
  if (point.min_spec != null && num < point.min_spec) return true;
  return false;
}

// "saved" renders nothing — that's the normal steady state and doesn't need
// to be announced; only call out that something's actively happening.
function statusLabel(state) {
  if (state === "saving") return "Saving…";
  if (state === "unsaved") return "Unsaved changes…";
  return "";
}

// Find# columns and their specs belong to the part's Data Sheet Template
// (see DataSheetTemplate.jsx) — this page only reuses them read-only. The
// only things an inspector edits here are the header fields and the sample
// rows/values. Everything autosaves (debounced) while the sheet is
// in_progress — there's no explicit save button, and nothing is lost on
// refresh once a save round-trip has completed.
export default function InspectionCapture() {
  const { inspectionId } = useParams();
  const { user } = useAuth();
  const [inspection, setInspection] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [header, setHeader] = useState({});
  const [samples, setSamples] = useState([1]);
  const [sampleCountInput, setSampleCountInput] = useState("");
  const [sampleRejectedInput, setSampleRejectedInput] = useState("");
  // Whether the Measurements grid is showing every sample row or a collapsed
  // summary -- set from the loaded sample count on initial load only (see
  // `load`), then left alone on every later autosave refresh so it doesn't
  // keep re-collapsing a grid the inspector just chose to expand.
  const [expandedSamples, setExpandedSamples] = useState(true);
  const [values, setValues] = useState({});
  // 100%-inspection tallies -- balloon_point_id -> { qty_inspected, qty_rejected, reject_notes }.
  const [pointSummaries, setPointSummaries] = useState({});
  const [auditLog, setAuditLog] = useState([]);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState("");
  const [headerStatus, setHeaderStatus] = useState("saved");
  const [notesStatus, setNotesStatus] = useState("saved");
  const [measurementsStatus, setMeasurementsStatus] = useState("saved");
  const [summariesStatus, setSummariesStatus] = useState("saved");
  const [signingAction, setSigningAction] = useState(null); // null | "approved" | "conditionally_approved" | "rejected"
  const [signerName, setSignerName] = useState("");
  const [signingReason, setSigningReason] = useState("");
  const [signing, setSigning] = useState(false);
  const [sampleMenu, setSampleMenu] = useState(null); // { sampleNumber, x, y }
  const [confirm, confirmDialog] = useConfirm();

  const isLocked = inspection ? inspection.status !== "in_progress" : false;
  const hasTemplate = drawing ? drawing.points.length > 0 : false;
  // Hides the Max/MEAN/Min spec rows entirely when nothing on this sheet has
  // a numeric spec (e.g. a Fixture-only Data Sheet) -- otherwise they'd just
  // be three rows of "—" with nothing to show.
  const hasAnySpec = drawing ? drawing.points.some((p) => !isSpecless(p)) : false;
  // hundred_percent_inspection pulls specless (check) columns out of the
  // sample x point grid entirely, into the compact qty-inspected/qty-rejected
  // summary table instead -- a numeric column always stays in the grid,
  // since a single tally can't stand in for a real measurement. Inherited
  // from the Data Sheet Template at creation (see POST /api/inspections),
  // not editable here. While still in_progress, this follows the template's
  // CURRENT setting live -- QC flagging the template after the sheet was
  // already started (a very normal order of operations) takes effect on it
  // immediately, rather than being stuck with whatever was true at creation.
  // Once signed, it freezes at whatever was true at that point (inspection's
  // own copy), matching every other spec-as-signed field on a locked sheet.
  const isHundredPercent = isLocked
    ? !!inspection?.hundred_percent_inspection
    : !!(drawing?.hundred_percent_inspection ?? inspection?.hundred_percent_inspection);
  const summaryPoints = drawing && isHundredPercent ? drawing.points.filter(isSpecless) : [];
  const gridPoints = drawing ? (isHundredPercent ? drawing.points.filter((p) => !isSpecless(p)) : drawing.points) : [];
  // Matches the server-side requireRole("qc", "admin") guard on PUT
  // /:id/status -- hidden here too so an operator doesn't go through the
  // whole "type your name to sign" flow only to hit a 403 at the end.
  const canSign = ["qc", "admin"].includes(user?.role);
  // Matches DataSheetTemplate.jsx's own guard and the requireRole("qc",
  // "admin", "engineer") now on every write route in
  // backend/src/routes/drawings.js.
  const canEditTemplate = ["qc", "admin", "engineer"].includes(user?.role);

  // Snapshots of what's actually been saved, so the beforeunload guard below
  // (and the autosave effects) can tell "typed but not saved" apart from
  // "matches the database".
  const savedHeaderRef = useRef("{}");
  const savedNotesRef = useRef("");
  const savedValuesRef = useRef("{}");
  const savedSummariesRef = useRef("{}");

  const applyHeaderState = (insp) => {
    const headerState = {};
    headerFieldsFor(insp.type).forEach(([field]) => {
      if (field === "date") {
        // "date" is stored as a full timestamp on older records — the date
        // input only accepts a plain YYYY-MM-DD value.
        headerState.date = insp.date ? insp.date.slice(0, 10) : "";
      } else if (field === "customer") {
        // Falls back to the customer folder this part lives under — the
        // customer was already chosen before the inspector ever got here.
        headerState.customer = insp.customer || insp.client_name || "";
      } else if (BOOLEAN_HEADER_FIELDS.includes(field)) {
        // Stored as 0/1 -- normalized to a real boolean for the checkbox.
        headerState[field] = !!insp[field];
      } else {
        headerState[field] = insp[field] ?? "";
      }
    });
    setHeader(headerState);
    savedHeaderRef.current = JSON.stringify(headerState);
  };

  const applyNotesState = (insp) => {
    const n = insp.notes ?? "";
    setNotes(n);
    savedNotesRef.current = n;
  };

  const applyMeasurementState = (insp) => {
    // Starts at 1 row; further rows are only added by the inspector
    // clicking "+ Add Sample", so this just reflects whatever's already
    // been recorded.
    const sampleNumbers = [...new Set(insp.measurements.map((m) => m.sample_number))].sort((a, b) => a - b);
    setSamples(sampleNumbers.length > 0 ? sampleNumbers : [1]);

    const initial = {};
    insp.measurements.forEach((m) => {
      initial[cellKey(m.balloon_point_id, m.sample_number)] = m.measured_value ?? "";
    });
    setValues(initial);
    savedValuesRef.current = JSON.stringify(initial);
  };

  const applySummaryState = (insp) => {
    const initial = {};
    const explicitIds = new Set();
    (insp.pointSummaries || []).forEach((s) => {
      explicitIds.add(s.balloon_point_id);
      initial[s.balloon_point_id] = {
        qty_inspected: s.qty_inspected ?? 0,
        qty_rejected: s.qty_rejected ?? 0,
        reject_notes: s.reject_notes ?? "",
      };
    });
    // A point with real legacy measurements (filled via the older row-by-row
    // "Fill + Mark OK" grid before this sheet's template got flagged as 100%
    // inspection) but no explicit tally yet -- pre-fill from those instead of
    // starting blank, so the existing work doesn't look like it vanished.
    (insp.points || [])
      .filter((p) => isSpecless(p) && !explicitIds.has(p.id))
      .forEach((p) => {
        const derived = summarizeCheckPoint(p, insp);
        if (derived.qtyInspected > 0) {
          initial[p.id] = {
            qty_inspected: derived.qtyInspected,
            qty_rejected: derived.qtyRejected,
            reject_notes: derived.rejectNotes,
          };
        }
      });
    setPointSummaries(initial);
    savedSummariesRef.current = JSON.stringify(initial);
  };

  // Full load — only used on first mount / navigating to a different
  // inspection, where there's no unsaved local state yet to protect.
  const load = async () => {
    try {
      const insp = await api.getInspection(inspectionId);
      setInspection(insp);

      const drawingData = insp.drawing_id ? await api.getDrawing(insp.drawing_id) : null;
      setDrawing(drawingData);

      applyHeaderState(insp);
      applyNotesState(insp);
      applyMeasurementState(insp);
      applySummaryState(insp);
      const sampleCount = new Set(insp.measurements.map((m) => m.sample_number)).size || 1;
      setExpandedSamples(sampleCount <= SAMPLE_COLLAPSE_THRESHOLD);

      api.getAuditLog(inspectionId).then(setAuditLog).catch(() => {});
    } catch (e) {
      setError(e.message);
    }
  };

  // After an individual save, refresh only `inspection` (status, audit-log
  // dependent bits) and the audit log — never blindly re-derive header/
  // notes/samples/values here, since that would blow away whatever the
  // OTHER sections have typed but not yet saved themselves.
  const refreshInspection = async () => {
    const insp = await api.getInspection(inspectionId);
    setInspection(insp);
    api.getAuditLog(inspectionId).then(setAuditLog).catch(() => {});
    return insp;
  };

  // The actual save calls — used both by the debounced autosave effects
  // below and to flush pending edits immediately before Approve/Reject.
  const saveHeaderNow = async (h) => {
    await api.updateInspection(inspectionId, h);
    const insp = await refreshInspection();
    applyHeaderState(insp);
  };

  const saveNotesNow = async (n) => {
    await api.updateInspection(inspectionId, { notes: n });
    const insp = await refreshInspection();
    applyNotesState(insp);
  };

  const saveMeasurementsNow = async () => {
    const measurements = [];
    // gridPoints, not drawing.points -- a specless column pulled into the
    // 100%-inspection summary table is saved through point-summaries
    // instead, never as sample-grid measurements rows.
    gridPoints.forEach((p) => {
      samples.forEach((s) => {
        const raw = values[cellKey(p.id, s)];
        if (raw !== "" && raw !== undefined) {
          // Points with no Max/Min spec (e.g. a Fixture check) have nothing
          // numeric to compare against, so a non-numeric entry like "OK" is
          // saved as free text rather than discarded as null.
          const num = toStoredNumber(raw);
          const measured_value = num == null ? String(raw).trim() : num;
          measurements.push({ balloon_point_id: p.id, sample_number: s, measured_value });
        }
      });
    });
    await api.saveMeasurements(inspectionId, measurements);
    const insp = await refreshInspection();
    applyMeasurementState(insp);
  };

  // Always sends every specless (check) point's tally, even an untouched
  // 0/0 one -- simpler than tracking which ones changed, and harmless since
  // the upsert just writes the same zeros back.
  const saveSummariesNow = async () => {
    const checkPointIds = (drawing?.points || []).filter(isSpecless).map((p) => p.id);
    const summaries = checkPointIds.map((id) => ({
      balloon_point_id: id,
      qty_inspected: Number(pointSummaries[id]?.qty_inspected) || 0,
      qty_rejected: Number(pointSummaries[id]?.qty_rejected) || 0,
      reject_notes: pointSummaries[id]?.reject_notes || "",
    }));
    await api.savePointSummaries(inspectionId, summaries);
    const insp = await refreshInspection();
    applySummaryState(insp);
  };

  useEffect(() => {
    load();
  }, [inspectionId]);

  // Autosave: Header. Debounced so a whole burst of keystrokes across
  // several fields becomes one save shortly after the inspector pauses,
  // not one request per keystroke.
  useEffect(() => {
    if (!inspection || isLocked) return;
    if (JSON.stringify(header) === savedHeaderRef.current) {
      setHeaderStatus("saved");
      return;
    }
    setHeaderStatus("unsaved");
    if (!header.date) return; // nothing to persist yet without a valid date
    const timer = setTimeout(async () => {
      setHeaderStatus("saving");
      try {
        await saveHeaderNow(header);
        setHeaderStatus("saved");
      } catch (e) {
        setError(e.message);
        setHeaderStatus("unsaved");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header, isLocked, inspection]);

  // Autosave: Notes.
  useEffect(() => {
    if (!inspection || isLocked) return;
    if (notes === savedNotesRef.current) {
      setNotesStatus("saved");
      return;
    }
    setNotesStatus("unsaved");
    const timer = setTimeout(async () => {
      setNotesStatus("saving");
      try {
        await saveNotesNow(notes);
        setNotesStatus("saved");
      } catch (e) {
        setError(e.message);
        setNotesStatus("unsaved");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, isLocked, inspection]);

  // Autosave: Measurements — saves the whole grid (same payload the old
  // "Save measurements" button sent), debounced after the last edited cell.
  useEffect(() => {
    if (!inspection || isLocked || !hasTemplate) return;
    if (JSON.stringify(values) === savedValuesRef.current) {
      setMeasurementsStatus("saved");
      return;
    }
    setMeasurementsStatus("unsaved");
    const timer = setTimeout(async () => {
      setMeasurementsStatus("saving");
      try {
        await saveMeasurementsNow();
        setMeasurementsStatus("saved");
      } catch (e) {
        setError(e.message);
        setMeasurementsStatus("unsaved");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, isLocked, inspection, hasTemplate]);

  // Autosave: 100%-inspection point summaries -- only relevant once
  // isHundredPercent is true (inherited from the template); mirrors the
  // Measurements autosave above.
  useEffect(() => {
    if (!inspection || isLocked || !isHundredPercent) return;
    if (JSON.stringify(pointSummaries) === savedSummariesRef.current) {
      setSummariesStatus("saved");
      return;
    }
    setSummariesStatus("unsaved");
    const timer = setTimeout(async () => {
      setSummariesStatus("saving");
      try {
        await saveSummariesNow();
        setSummariesStatus("saved");
      } catch (e) {
        setError(e.message);
        setSummariesStatus("unsaved");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointSummaries, isLocked, inspection, isHundredPercent]);

  // Warn before closing/refreshing the tab if something is mid-autosave —
  // the debounce delay leaves a brief window where the very latest
  // keystroke hasn't reached the server yet.
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      const dirty =
        JSON.stringify(header) !== savedHeaderRef.current ||
        notes !== savedNotesRef.current ||
        JSON.stringify(values) !== savedValuesRef.current ||
        JSON.stringify(pointSummaries) !== savedSummariesRef.current;
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [header, notes, values, pointSummaries]);

  useEffect(() => {
    if (!sampleMenu) return;
    const close = () => setSampleMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [sampleMenu]);

  const handleAddSample = () => {
    const next = samples.length > 0 ? Math.max(...samples) + 1 : 1;
    setSamples([...samples, next]);
  };

  // Whichever of sample rows 1..target don't already exist yet -- shared by
  // handleHeaderChange's sampling-plan auto-grow below and the 100%-
  // inspection action further down. Never returns anything for a row that's
  // already there, so it can't ever be used to duplicate or (via either
  // caller) remove a row that already has real measurements on it.
  const missingSampleRows = (target) => {
    const existing = new Set(samples);
    const missing = [];
    for (let i = 1; i <= target; i++) {
      if (!existing.has(i)) missing.push(i);
    }
    return missing;
  };

  const handleHeaderChange = (field, value) => {
    setHeader((prev) => ({ ...prev, [field]: value }));

    // Typing a sampling plan n= grows the Measurements grid to match, so the
    // inspector doesn't have to click "+ Add Sample" n times by hand. Only
    // ever adds rows, never removes them -- shrinking n (or a stray
    // keystroke mid-edit) must never delete a row that might already carry
    // real measurements, same safety property missingSampleRows documents.
    if (field === "sampling_plan_n") {
      const target = Math.floor(Number(value));
      if (Number.isFinite(target) && target > 0) {
        const missing = missingSampleRows(target);
        if (missing.length > 0) {
          const allRows = [...samples, ...missing].sort((a, b) => a - b);
          setSamples(allRows);
          if (allRows.length > SAMPLE_COLLAPSE_THRESHOLD) setExpandedSamples(false);
        }
      }
    }
  };

  // For a 100% inspection (every piece in the lot checked and expected to
  // mostly pass, not just a sample plan's n=) -- one click instead of adding
  // N rows AND clicking "Mark all OK" on every check column. Only fills the
  // specless (Fixture/Visual-style pass/fail) columns; any numeric column on
  // the same template is left blank, since a real measurement can't be
  // assumed the way a routine pass/fail check can. An optional reject count
  // marks that many of the rows Not OK instead of OK (trailing rows,
  // arbitrarily -- the inspector doesn't know in advance which physical
  // piece will fail, just the tally) so the sheet doesn't start out reading
  // as a false all-pass; which specific row(s) failed and why gets sorted
  // out afterward via "Show all rows".
  const applyFullPassInspection = () => {
    const target = Math.floor(Number(sampleCountInput));
    if (!Number.isFinite(target) || target < 1) return;
    const rejectedRaw = Math.floor(Number(sampleRejectedInput));
    const rejectedCount = Number.isFinite(rejectedRaw) ? Math.min(Math.max(rejectedRaw, 0), target) : 0;
    const missing = missingSampleRows(target);
    const allRows = missing.length > 0 ? [...samples, ...missing].sort((a, b) => a - b) : samples;
    if (missing.length > 0) setSamples(allRows);
    if (allRows.length > SAMPLE_COLLAPSE_THRESHOLD) setExpandedSamples(false);

    const checkPointIds = gridPoints.filter(isSpecless).map((p) => p.id);
    if (checkPointIds.length > 0) {
      const rejectedRows = new Set(allRows.slice(allRows.length - rejectedCount));
      setValues((prev) => {
        const next = { ...prev };
        allRows.forEach((s) => {
          const value = formatPassFail(rejectedRows.has(s) ? "not_ok" : "ok", "");
          checkPointIds.forEach((pointId) => {
            next[cellKey(pointId, s)] = value;
          });
        });
        return next;
      });
    }
    setSampleCountInput("");
    setSampleRejectedInput("");
  };

  // Drives the collapsed-grid summary line -- counts how many check-column
  // cells (across every sample row) aren't a plain "OK", so a collapsed 100%
  // inspection with a real failure buried in it still reads as needing
  // attention rather than silently looking done.
  const sampleIssueCount = () => {
    // gridPoints, not drawing.points -- in 100%-inspection mode, specless
    // columns live in the summary table instead, so they shouldn't count
    // toward the sample grid's own collapsed-view issue count.
    const checkPoints = gridPoints.filter(isSpecless);
    if (checkPoints.length === 0) return 0;
    let issues = 0;
    samples.forEach((s) => {
      checkPoints.forEach((p) => {
        if (parsePassFail(values[cellKey(p.id, s)] ?? "").state !== "ok") issues += 1;
      });
    });
    return issues;
  };

  const handleSampleContextMenu = (e, sampleNumber) => {
    e.preventDefault();
    setSampleMenu({ sampleNumber, x: e.clientX, y: e.clientY });
  };

  const handleDeleteSample = async (sampleNumber) => {
    setSampleMenu(null);
    if (!(await confirm("Are you sure you want to delete this row?"))) return;
    try {
      await api.deleteSample(inspectionId, sampleNumber);
      // Remove just this row locally — do NOT re-derive samples/values from
      // the server here, since that would wipe unsaved edits sitting in
      // every OTHER row (they only reach the DB once the autosave debounce
      // fires).
      setSamples((prev) => prev.filter((s) => s !== sampleNumber));
      setValues((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => {
          const [, sNum] = k.split(":");
          if (Number(sNum) === sampleNumber) delete next[k];
        });
        return next;
      });
      await refreshInspection();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleChange = (pointId, sampleNumber, value) => {
    setValues((prev) => ({ ...prev, [cellKey(pointId, sampleNumber)]: value }));
  };

  const handleSummaryChange = (pointId, field, value) => {
    setPointSummaries((prev) => ({
      ...prev,
      [pointId]: { qty_inspected: 0, qty_rejected: 0, reject_notes: "", ...prev[pointId], [field]: value },
    }));
  };

  // Fills every existing sample row for one spec-less (OK/Not OK) point at
  // once -- for a check like Fixture where the same result usually applies
  // to every piece, so the inspector doesn't have to tap "OK" once per row.
  const handleMarkAllOk = (pointId) => {
    setValues((prev) => {
      const next = { ...prev };
      samples.forEach((s) => {
        next[cellKey(pointId, s)] = "OK";
      });
      return next;
    });
  };

  // Flushes any pending (debounced but not-yet-fired) edits immediately —
  // called before Approve/Reject so signing always reflects the very latest
  // typing, not whatever happened to have already synced. Returns the truly
  // fresh inspection record, since `inspection` in the caller's closure is
  // stale until React re-renders.
  const flushPendingSaves = async () => {
    if (header.date && JSON.stringify(header) !== savedHeaderRef.current) {
      await saveHeaderNow(header);
    }
    if (notes !== savedNotesRef.current) {
      await saveNotesNow(notes);
    }
    if (hasTemplate && JSON.stringify(values) !== savedValuesRef.current) {
      await saveMeasurementsNow();
    }
    if (isHundredPercent && JSON.stringify(pointSummaries) !== savedSummariesRef.current) {
      await saveSummariesNow();
    }
    return refreshInspection();
  };

  const startSigning = async (action) => {
    setError(null);
    let latest;
    try {
      latest = await flushPendingSaves();
    } catch (e) {
      setError(e.message);
      return;
    }
    if (!latest.inspector || !latest.inspector.trim()) {
      setError("Set the inspector name (By) before approving or rejecting this Data Sheet.");
      return;
    }
    setSigningAction(action);
    setSignerName(user?.full_name ?? "");
    setSigningReason("");
  };

  const cancelSigning = () => {
    setSigningAction(null);
    setSignerName("");
    setSigningReason("");
  };

  const confirmSigning = async () => {
    setSigning(true);
    setError(null);
    try {
      await api.setStatus(inspectionId, signingAction, signerName, signingReason);
      setSigningAction(null);
      setSignerName("");
      setSigningReason("");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSigning(false);
    }
  };

  if (error && !inspection) {
    return (
      <div className="page">
        <Link to="/" className="back-link">
          ← Home
        </Link>
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!inspection || !drawing) {
    return (
      <div className="page">
        <p>Loading...</p>
      </div>
    );
  }

  const measurementsByCell = Object.fromEntries(
    inspection.measurements.map((m) => [cellKey(m.balloon_point_id, m.sample_number), m])
  );

  return (
    <div className="page">
      <Link
        to={
          inspection.operation_id
            ? `/parts/${inspection.part_id}/operations/${inspection.operation_id}?type=${inspection.type}`
            : `/parts/${inspection.part_id}/inspections${inspection.type !== "final" ? `?type=${inspection.type}` : ""}`
        }
        className="back-link"
      >
        {inspection.operation_id ? "← Operation" : "← Data Sheets"}
      </Link>
      <div className="sheet-title-row">
        <div>
          <h1>Data Sheet — {inspection.part_number}</h1>
          <span className={`status status-${resultStatus(inspection)}`}>{resultLabel(resultStatus(inspection))}</span>
        </div>
        <div className="sheet-toolbar">
          <Link to={`/inspections/${inspectionId}/sheet`} className="toolbar-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            </svg>
            View / Print
          </Link>
          <a
            href={`${BASE_URL}/inspections/${inspectionId}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="toolbar-btn"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            Export PDF
          </a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {isLocked && (
        <p className="sign-panel">
          This Data Sheet has been signed and is now locked — it can no longer be edited. Use "Export PDF" or
          "View / Print" above to see the final record.
        </p>
      )}

      <section className="form-card">
        <div className="form-card-header">
          <h2>Header</h2>
          {!isLocked && statusLabel(headerStatus) && (
            <span className={`autosave-pill autosave-pill-${headerStatus}`}>{statusLabel(headerStatus)}</span>
          )}
        </div>
        <div className="header-grid">
          {headerFieldsFor(inspection.type).map(([field, label]) =>
            BOOLEAN_HEADER_FIELDS.includes(field) ? (
              <label key={field} className="header-field header-field-checkbox">
                <input
                  type="checkbox"
                  checked={!!header[field]}
                  disabled={isLocked}
                  onChange={(e) => handleHeaderChange(field, e.target.checked)}
                />
                <span className="muted">{label}</span>
              </label>
            ) : (
              <label key={field} className="header-field">
                <span className="muted">{label}</span>
                {isLocked ? (
                  <span className="locked-value">{header[field] || "—"}</span>
                ) : (
                  <input
                    type={field === "date" ? "date" : "text"}
                    value={header[field] ?? ""}
                    onChange={(e) => handleHeaderChange(field, e.target.value)}
                  />
                )}
              </label>
            )
          )}
        </div>
      </section>

      <section className="form-card">
        <div className="form-card-header">
          <h2>Measurements</h2>
          {!isLocked && hasTemplate && statusLabel(measurementsStatus) && (
            <span className={`autosave-pill autosave-pill-${measurementsStatus}`}>
              {statusLabel(measurementsStatus)}
            </span>
          )}
        </div>

        {!hasTemplate ? (
          <p className="sign-panel">
            This part doesn't have a Data Sheet Template yet — there are no Find# columns to measure.{" "}
            {canEditTemplate ? (
              <>
                <Link
                  to={
                    inspection.operation_id
                      ? `/parts/${inspection.part_id}/template?operation_id=${inspection.operation_id}`
                      : `/parts/${inspection.part_id}/template`
                  }
                >
                  Set up the Data Sheet Template
                </Link>{" "}
                first.
              </>
            ) : (
              "Ask QC to set it up first."
            )}
          </p>
        ) : (
          <>
            {isHundredPercent && summaryPoints.length > 0 && (
              <div className="table-scroll">
                <table className="capture-table summary-table">
                  <thead>
                    <tr>
                      <th>Find #</th>
                      <th>Qty Inspected</th>
                      <th>Qty Rejected</th>
                      <th>Reject Notes</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryPoints.map((p) => {
                      const s = pointSummaries[p.id] || { qty_inspected: 0, qty_rejected: 0, reject_notes: "" };
                      const rejected = Number(s.qty_rejected) > 0;
                      return (
                        <tr key={p.id}>
                          <td>{p.balloon_number}</td>
                          <td>
                            {isLocked ? (
                              <span className="locked-value">{s.qty_inspected ?? "—"}</span>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                className="spec-input summary-qty-input"
                                value={s.qty_inspected ?? ""}
                                onChange={(e) => handleSummaryChange(p.id, "qty_inspected", e.target.value)}
                              />
                            )}
                          </td>
                          <td>
                            {isLocked ? (
                              <span className="locked-value">{s.qty_rejected ?? 0}</span>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                className="spec-input summary-qty-input"
                                value={s.qty_rejected ?? ""}
                                onChange={(e) => handleSummaryChange(p.id, "qty_rejected", e.target.value)}
                              />
                            )}
                          </td>
                          <td>
                            {rejected ? (
                              isLocked ? (
                                <span className="locked-value">{s.reject_notes || "—"}</span>
                              ) : (
                                <input
                                  type="text"
                                  className="summary-notes-input"
                                  placeholder="Reason for each reject"
                                  value={s.reject_notes}
                                  onChange={(e) => handleSummaryChange(p.id, "reject_notes", e.target.value)}
                                />
                              )
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            <span className={`status ${rejected ? "status-rejected" : "status-approved"}`}>
                              {rejected ? `${s.qty_rejected} Rejected` : "Approved"}
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
                <table className="capture-table capture-table-transposed">
                  <thead>
                    <tr>
                      <th>Find #</th>
                      {gridPoints.map((p) => (
                        <th key={p.id}>
                          {p.balloon_number}
                          {!isLocked && isSpecless(p) && samples.length > 1 && (
                            <button type="button" className="mark-all-ok-btn" onClick={() => handleMarkAllOk(p.id)}>
                              Mark all OK
                            </button>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hasAnySpec && (
                      <>
                        <tr className="spec-row">
                          <td>Max. Spec.</td>
                          {gridPoints.map((p) => (
                            <td key={p.id}>{p.max_spec != null ? p.max_spec.toFixed(p.decimal_places ?? 3) : "—"}</td>
                          ))}
                        </tr>
                        <tr className="spec-row">
                          <td>MEAN</td>
                          {gridPoints.map((p) => (
                            <td key={p.id}>{p.mean_value != null ? p.mean_value.toFixed(p.decimal_places ?? 3) : "—"}</td>
                          ))}
                        </tr>
                        <tr className="spec-row">
                          <td>Min. Spec.</td>
                          {gridPoints.map((p) => (
                            <td key={p.id}>{p.min_spec != null ? p.min_spec.toFixed(p.decimal_places ?? 3) : "—"}</td>
                          ))}
                        </tr>
                      </>
                    )}
                    {expandedSamples || samples.length <= SAMPLE_COLLAPSE_THRESHOLD ? (
                      <>
                        {samples.map((s, sampleIndex) => (
                          <tr
                            key={s}
                            className={`sample-row${sampleIndex % 2 === 1 ? " sample-row-alt" : ""}`}
                            onContextMenu={(e) => handleSampleContextMenu(e, s)}
                          >
                            <td>{Number.isInteger(s) ? s : s.toFixed(1)}</td>
                            {gridPoints.map((p) => {
                              const value = values[cellKey(p.id, s)] ?? "";
                              const specless = isSpecless(p);
                              if (isLocked) {
                                // Frozen historical record — reflects the spec as it
                                // was when this Data Sheet was signed, even if the
                                // template's spec has since changed.
                                const measurement = measurementsByCell[cellKey(p.id, s)];
                                const failed = specless
                                  ? parsePassFail(value).state === "not_ok"
                                  : measurement?.within_tolerance === 0;
                                return (
                                  <td key={p.id}>
                                    <span className={failed ? "locked-value-fail" : "locked-value"}>{value || "—"}</span>
                                  </td>
                                );
                              }
                              if (specless) {
                                return (
                                  <td key={p.id}>
                                    <PassFailCell value={value} onChange={(v) => handleChange(p.id, s, v)} />
                                  </td>
                                );
                              }
                              const outOfTolerance = isOutOfTolerance(p, value);
                              return (
                                <td key={p.id}>
                                  <DecimalCell
                                    value={value}
                                    onChange={(v) => handleChange(p.id, s, v)}
                                    decimals={p.decimal_places ?? 3}
                                    className={outOfTolerance ? "input-out-of-tolerance" : ""}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {samples.length > SAMPLE_COLLAPSE_THRESHOLD && (
                          <tr>
                            <td colSpan={gridPoints.length + 1} className="samples-collapse-cell">
                              <button type="button" className="link-button" onClick={() => setExpandedSamples(false)}>
                                Collapse rows
                              </button>
                            </td>
                          </tr>
                        )}
                      </>
                    ) : (
                      <tr>
                        <td colSpan={gridPoints.length + 1} className="samples-collapsed-cell">
                          <span>
                            {samples.length} samples
                            {sampleIssueCount() > 0 ? ` — ${sampleIssueCount()} need attention` : " — all OK"}
                          </span>
                          <button type="button" className="link-button" onClick={() => setExpandedSamples(true)}>
                            Show all rows
                          </button>
                        </td>
                      </tr>
                    )}
                    {!isLocked && (
                      <tr>
                        <td colSpan={gridPoints.length + 1} className="add-row-cell-container">
                          <span className="add-row-cell" onClick={handleAddSample}>
                            + Add Sample
                          </span>
                          <span className="bulk-sample-control">
                            <span className="muted">100% inspection, qty</span>
                            <input
                              type="number"
                              min="1"
                              className="sample-count-input"
                              placeholder="e.g. 112"
                              value={sampleCountInput}
                              onChange={(e) => setSampleCountInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") applyFullPassInspection();
                              }}
                            />
                            <span className="muted">rejected</span>
                            <input
                              type="number"
                              min="0"
                              className="sample-count-input"
                              placeholder="0"
                              value={sampleRejectedInput}
                              onChange={(e) => setSampleRejectedInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") applyFullPassInspection();
                              }}
                            />
                            <button
                              type="button"
                              onClick={applyFullPassInspection}
                              title="Creates all sample rows and marks the OK/Not-OK columns OK, except the rejected count which is marked Not OK"
                            >
                              Fill + Mark OK
                            </button>
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="form-card">
        <div className="form-card-header">
          <h2>Notes</h2>
          {!isLocked && statusLabel(notesStatus) && (
            <span className={`autosave-pill autosave-pill-${notesStatus}`}>{statusLabel(notesStatus)}</span>
          )}
        </div>
        {isLocked ? (
          <p className="locked-value">{notes || "—"}</p>
        ) : (
          <textarea
            className="notes-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        )}
      </section>

      {!isLocked && canSign && (
        <section className="form-card signoff-card">
          <h2>Sign-off</h2>
          <div className="actions-row">
            <button onClick={() => startSigning("approved")} className="approve">
              Approve
            </button>
            <button onClick={() => startSigning("conditionally_approved")} className="conditional">
              Conditionally Approve
            </button>
            <button onClick={() => startSigning("rejected")} className="reject">
              Reject
            </button>
          </div>
        </section>
      )}

      {signingAction && (
        <div className="sign-panel">
          <p>
            Signing as <strong>{user?.full_name}</strong> to <strong>{resultLabel(signingAction)}</strong> this
            inspection. Type your full name to confirm:
          </p>
          {signingAction === "conditionally_approved" && (
            <textarea
              className="notes-textarea"
              value={signingReason}
              onChange={(e) => setSigningReason(e.target.value)}
              placeholder="Reason for conditional approval (required)"
              rows={2}
            />
          )}
          <div className="actions-row">
            <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Full name" />
            <button
              onClick={confirmSigning}
              disabled={signing || (signingAction === "conditionally_approved" && !signingReason.trim())}
              className="approve"
            >
              Confirm &amp; Sign
            </button>
            <button onClick={cancelSigning} className="secondary-btn">
              Cancel
            </button>
          </div>
        </div>
      )}

      <section className="form-card">
        <h2>History</h2>
        <ul className="audit-timeline">
          {auditLog.map((entry) => (
            <li key={`${entry.action}-${entry.id}-${entry.at}`} className="audit-item">
              <span className={`audit-dot audit-dot-${auditTone(entry.action)}`} />
              <span className="audit-item-body">
                <strong>{ACTION_LABELS[entry.action] ?? entry.action}</strong>
                {entry.user_name && <span className="muted"> by {entry.user_name}</span>}
              </span>
              <span className="audit-item-time muted" title={entry.at}>
                {timeAgo(entry.at)}
              </span>
            </li>
          ))}
          {auditLog.length === 0 && <li className="muted">No history yet.</li>}
        </ul>
      </section>

      {sampleMenu && (
        <ul className="context-menu" style={{ top: sampleMenu.y, left: sampleMenu.x }}>
          <li className="context-menu-danger" onClick={() => handleDeleteSample(sampleMenu.sampleNumber)}>
            Delete
          </li>
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
