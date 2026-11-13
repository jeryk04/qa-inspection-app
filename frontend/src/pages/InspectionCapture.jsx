import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, downloadInspectionPdf, downloadInspectionXlsx, inspectionPdfName } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { hasAnyRole } from "../lib/roles";
import { formatSpec, toStoredNumber } from "../lib/numeric";
import { resultLabel, resultStatus, showsQuantity, timeAgo } from "../lib/format";
import { formatPassFail, isSpecless, parsePassFail, summarizeCheckPoint } from "../lib/passfail";
import { formatMinutes, reminderDueAt } from "../lib/reminders";
import DecimalCell from "../components/DecimalCell";
import PassFailCell from "../components/PassFailCell";
import PageNav from "../components/PageNav";
import { useConfirm } from "../hooks/useConfirm";

const BASE_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001/api`;
// Uploaded files (photos, drawings) are served from the API origin as plain
// /uploads/... paths, not under /api -- same derivation as
// DataSheetTemplate.jsx's API_ORIGIN.
const API_ORIGIN = BASE_URL.replace(/\/api$/, "");
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
  ["sampling_plan_n", "Sampling Plan"],
  ["sampling_plan_c", "Total Rejected"],
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
  ["sampling_plan_n", "Sampling Plan"],
  ["sampling_plan_c", "Total Rejected"],
  ["inspector", "By (Inspector)"],
];

// Final Inspection is the last stop in Set-up -> In-Process -> Final, so it's
// the only type that can gate on In-Process having already happened -- see
// the matching hasQualifyingInProcess check on PUT /:id/status.
const FINAL_HEADER_FIELDS = [...HEADER_FIELDS, ["requires_in_process", "Operator In-Process Data Sheet required"]];

// QC's Set-up / In-Process sheets drop Quantity -- see lib/format.js's
// showsQuantity.
function headerFieldsFor(inspection) {
  if (inspection.type === "incoming") return INCOMING_HEADER_FIELDS;
  if (inspection.type === "final") return FINAL_HEADER_FIELDS;
  return showsQuantity(inspection) ? HEADER_FIELDS : HEADER_FIELDS.filter(([field]) => field !== "quantity");
}

function hasPerOperationRequirement(inspection) {
  return inspection.type === "final" && (inspection.operator_operations?.length ?? 0) > 1;
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
  sample_rows_saved: "Sample log saved",
  sample_deleted: "Sample deleted",
  photo_uploaded: "Photo added",
  photo_deleted: "Photo removed",
  cert_uploaded: "Cert attached",
  cert_deleted: "Cert removed",
  tolerance_rechecked: "Spec changed — results re-checked",
  status_changed: "Status changed",
  signed_approved: "Signed — Approved",
  signed_rejected: "Signed — Rejected",
  unlocked: "Reopened for editing",
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

// Merges the Measurements grid's two independent autosave statuses (cell
// values, and -- machine_log_mode only -- the per-row Qty/Machine #/Comment)
// into the one pill shown in that card's header.
function combineStatus(...states) {
  if (states.includes("saving")) return "saving";
  if (states.includes("unsaved")) return "unsaved";
  return "saved";
}

// Find# columns and their specs belong to the part's Data Sheet Template
// (see DataSheetTemplate.jsx) — this page only reuses them read-only. The
// only things an inspector edits here are the header fields and the sample
// rows/values. Everything autosaves (debounced) while the sheet is
// in_progress — there's no explicit save button, and nothing is lost on
// refresh once a save round-trip has completed.
export default function InspectionCapture() {
  const { inspectionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
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
  // machine_log_mode's per-row fields -- sample_number -> { qty, machine_number, comment }.
  const [sampleRows, setSampleRows] = useState({});
  const [auditLog, setAuditLog] = useState([]);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState("");
  const [headerStatus, setHeaderStatus] = useState("saved");
  const [notesStatus, setNotesStatus] = useState("saved");
  const [measurementsStatus, setMeasurementsStatus] = useState("saved");
  const [summariesStatus, setSummariesStatus] = useState("saved");
  const [sampleRowsStatus, setSampleRowsStatus] = useState("saved");
  const [signingAction, setSigningAction] = useState(null); // null | "approved" | "conditionally_approved" | "rejected"
  const [signerName, setSignerName] = useState("");
  const [signingReason, setSigningReason] = useState("");
  const [signing, setSigning] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [sampleMenu, setSampleMenu] = useState(null); // { sampleNumber, x, y }
  const [confirm, confirmDialog] = useConfirm();
  // Optional supporting photos -- Final Inspection only (see the Photos
  // section further down), so not everything loads this for nothing, but
  // cheap enough either way that it's simplest to just always fetch it.
  const [photos, setPhotos] = useState([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  // Supplier cert PDFs -- Incoming Inspection only (see the Certs section).
  const [certs, setCerts] = useState([]);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [certError, setCertError] = useState(null);

  const isLocked = inspection ? inspection.status !== "in_progress" : false;
  // In-Process re-inspection reminder countdown (see lib/reminders.js) --
  // last_reading_at stays current because every save re-fetches the
  // inspection (refreshInspection below).
  const reminderDue =
    inspection && !isLocked ? reminderDueAt(inspection.reinspect_interval_minutes, inspection.last_reading_at) : null;
  const [reminderNow, setReminderNow] = useState(() => Date.now());
  useEffect(() => {
    if (reminderDue == null) return;
    setReminderNow(Date.now());
    const tick = setInterval(() => setReminderNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, [reminderDue]);
  const hasTemplate = drawing ? drawing.points.length > 0 : false;
  // Hides the Max/MEAN/Min spec rows entirely when nothing on this sheet has
  // a spec value recorded (e.g. a Fixture-only Data Sheet) -- otherwise
  // they'd just be three rows of "—" with nothing to show. Checked directly
  // against the spec fields, not isSpecless/is_check_column -- a check
  // column can carry a documented reference spec too (e.g. a Go/No-Go
  // gauge's nominal size), so its values still belong in these rows even
  // though the column itself captures as pass/fail.
  const hasAnySpec = drawing
    ? drawing.points.some((p) => p.max_spec != null || p.min_spec != null || p.mean_value != null)
    : false;
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
  // Same inheritance as isHundredPercent above -- see DataSheetTemplate.jsx's
  // "Machine log mode" toggle and schema.sql's machine_log_mode comment.
  const machineLogMode = isLocked
    ? !!inspection?.machine_log_mode
    : !!(drawing?.machine_log_mode ?? inspection?.machine_log_mode);
  const summaryPoints = drawing && isHundredPercent ? drawing.points.filter(isSpecless) : [];
  const gridPoints = drawing ? (isHundredPercent ? drawing.points.filter((p) => !isSpecless(p)) : drawing.points) : [];
  // Matches the server-side guard on PUT /:id/status -- QC/admin/supervisor
  // sign anything; an operator signs only their own Operator In-Process
  // sheets. Hidden otherwise so nobody goes through the whole "type your
  // name to sign" flow only to hit a 403 at the end.
  // Checked against every role the user holds (lib/roles.js).
  const canSign =
    hasAnyRole(user, ["qc", "admin", "supervisor", "qa_manager"]) ||
    (hasAnyRole(user, ["operator"]) &&
      inspection?.type === "in_process" &&
      inspection?.operation_scope === "in_process_operator");
  // Matches DataSheetTemplate.jsx's own guard and the requireRole("qc",
  // "admin", "engineer", "supervisor", "qa_manager") now on every write route in
  // backend/src/routes/drawings.js.
  const canEditTemplate = hasAnyRole(user, ["qc", "admin", "engineer", "supervisor", "qa_manager"]);
  // Matches the server-side guard on PUT /:id/unlock: Admin/Supervisor/QA
  // Manager can reopen any signed sheet; QC only one they signed themselves
  // (the latest signature), never someone else's.
  const isQcSigner = hasAnyRole(user, ["qc"]) && inspection?.signature?.user_id === user?.id;
  const canUnlock = hasAnyRole(user, ["admin", "supervisor", "qa_manager"]) || isQcSigner;

  // Snapshots of what's actually been saved, so the beforeunload guard below
  // (and the autosave effects) can tell "typed but not saved" apart from
  // "matches the database".
  const savedHeaderRef = useRef("{}");
  const savedNotesRef = useRef("");
  const savedValuesRef = useRef("{}");
  const savedSummariesRef = useRef("{}");
  const savedSampleRowsRef = useRef("{}");

  const applyHeaderState = (insp) => {
    const headerState = {};
    headerFieldsFor(insp).forEach(([field]) => {
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
    // A Final on a part with more than one Operator operation picks which
    // ones it requires (one checkbox each) instead of the single checkbox --
    // see requiredOperations in backend/src/routes/inspections.js.
    if (hasPerOperationRequirement(insp)) headerState.required_operation_ids = insp.required_operation_ids ?? [];
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

  const applySampleRowState = (insp) => {
    const initial = {};
    (insp.sampleRows || []).forEach((r) => {
      initial[r.sample_number] = {
        qty: r.qty ?? "",
        machine_number: r.machine_number ?? "",
        comment: r.comment ?? "",
      };
    });
    setSampleRows(initial);
    savedSampleRowsRef.current = JSON.stringify(initial);
  };

  // Full load — only used on first mount / navigating to a different
  // inspection, where there's no unsaved local state yet to protect.
  const load = async () => {
    try {
      const insp = await api.getInspection(inspectionId);
      setInspection(insp);

      const drawingData = insp.drawing_id ? await api.getDrawing(insp.drawing_id) : null;
      // The sheet's own column list, not the template's -- it keeps any
      // retired Find# this sheet already recorded readings in.
      setDrawing(drawingData && { ...drawingData, points: insp.points || [] });

      applyHeaderState(insp);
      applyNotesState(insp);
      applyMeasurementState(insp);
      applySummaryState(insp);
      applySampleRowState(insp);
      const sampleCount = new Set(insp.measurements.map((m) => m.sample_number)).size || 1;
      setExpandedSamples(sampleCount <= SAMPLE_COLLAPSE_THRESHOLD);

      api.getAuditLog(inspectionId).then(setAuditLog).catch(() => {});
      api.getInspectionPhotos(inspectionId).then(setPhotos).catch(() => {});
      if (insp.type === "incoming") {
        api.getInspectionCerts(inspectionId).then(setCerts).catch(() => {});
      }
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
  //
  // Each one only advances its saved*Ref to what it actually sent -- it
  // must NOT re-apply the server's response into the live editing state
  // (setHeader/setNotes/etc.), because the inspector may have kept typing
  // while the request was in flight (common on a slower tablet Wi-Fi
  // connection). Doing so would blow away that newer, not-yet-sent edit
  // with the stale value this save round-trip just echoed back.
  const saveHeaderNow = async (h) => {
    await api.updateInspection(inspectionId, h);
    savedHeaderRef.current = JSON.stringify(h);
    await refreshInspection();
  };

  const saveNotesNow = async (n) => {
    await api.updateInspection(inspectionId, { notes: n });
    savedNotesRef.current = n;
    await refreshInspection();
  };

  const saveMeasurementsNow = async () => {
    // A cell with nothing typed in it and no prior saved value is skipped
    // entirely -- no point sending a null for every untouched cell in a big
    // grid. But a cell that WAS saved and got cleared (fixing a typo) still
    // has to be sent, as an explicit measured_value: null, or the server
    // never learns it changed -- it just keeps the old value, and the
    // refresh below would write that stale value straight back into local
    // state, undoing the clear the inspector just did.
    const savedValues = JSON.parse(savedValuesRef.current);
    const measurements = [];
    // gridPoints, not drawing.points -- a specless column pulled into the
    // 100%-inspection summary table is saved through point-summaries
    // instead, never as sample-grid measurements rows.
    gridPoints.forEach((p) => {
      samples.forEach((s) => {
        const key = cellKey(p.id, s);
        const raw = values[key];
        const isEmpty = raw === "" || raw === undefined;
        const hadSavedValue = savedValues[key] !== undefined && savedValues[key] !== "";
        if (isEmpty && !hadSavedValue) return;

        // Points with no Max/Min spec (e.g. a Fixture check) have nothing
        // numeric to compare against, so a non-numeric entry like "OK" is
        // saved as free text rather than discarded as null.
        const num = isEmpty ? null : toStoredNumber(raw);
        const measured_value = isEmpty ? null : num == null ? String(raw).trim() : num;
        measurements.push({ balloon_point_id: p.id, sample_number: s, measured_value });
      });
    });
    const sentSnapshot = JSON.stringify(values);
    await api.saveMeasurements(inspectionId, measurements);
    savedValuesRef.current = sentSnapshot;
    await refreshInspection();
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
    const sentSnapshot = JSON.stringify(pointSummaries);
    await api.savePointSummaries(inspectionId, summaries);
    savedSummariesRef.current = sentSnapshot;
    await refreshInspection();
  };

  // Always sends every sample row's fields, even untouched blank ones --
  // same reasoning as saveSummariesNow above.
  const saveSampleRowsNow = async () => {
    const rows = samples.map((s) => ({
      sample_number: s,
      qty: sampleRows[s]?.qty || "",
      machine_number: sampleRows[s]?.machine_number || "",
      comment: sampleRows[s]?.comment || "",
    }));
    const sentSnapshot = JSON.stringify(sampleRows);
    await api.saveSampleRows(inspectionId, rows);
    savedSampleRowsRef.current = sentSnapshot;
    await refreshInspection();
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

  // Autosave: machine_log_mode's per-row Qty/Machine #/Comment -- only
  // relevant once machineLogMode is true (inherited from the template);
  // mirrors the point-summaries autosave above.
  useEffect(() => {
    if (!inspection || isLocked || !machineLogMode) return;
    if (JSON.stringify(sampleRows) === savedSampleRowsRef.current) {
      setSampleRowsStatus("saved");
      return;
    }
    setSampleRowsStatus("unsaved");
    const timer = setTimeout(async () => {
      setSampleRowsStatus("saving");
      try {
        await saveSampleRowsNow();
        setSampleRowsStatus("saved");
      } catch (e) {
        setError(e.message);
        setSampleRowsStatus("unsaved");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleRows, isLocked, inspection, machineLogMode]);

  // True while something typed hasn't reached the server yet -- the ~1s
  // autosave debounce (AUTOSAVE_DELAY_MS) leaves a brief window where the
  // very latest keystroke is still pending. Shared by the beforeunload guard
  // below (tab close/refresh) and guardedNavigate (in-app link clicks) --
  // React Router doesn't unload the page for the latter, so beforeunload
  // never fires for it, and a plain unmount would silently cancel the
  // pending debounced save (its setTimeout gets cleared on cleanup) with no
  // warning at all.
  const isDirty = () =>
    JSON.stringify(header) !== savedHeaderRef.current ||
    notes !== savedNotesRef.current ||
    JSON.stringify(values) !== savedValuesRef.current ||
    JSON.stringify(pointSummaries) !== savedSummariesRef.current ||
    JSON.stringify(sampleRows) !== savedSampleRowsRef.current;

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header, notes, values, pointSummaries, sampleRows]);

  // Guards the in-app "leave this Data Sheet" links (back link, View/Print)
  // -- if isDirty(), ask before navigating away instead of silently
  // discarding whatever hasn't autosaved yet.
  const guardedNavigate = async (e, to, navState) => {
    e.preventDefault();
    if (isDirty()) {
      const shouldSave = await confirm("You have unsaved changes on this Data Sheet. Save before leaving?", {
        confirmLabel: "Save & Leave",
        danger: false,
      });
      if (!shouldSave) return;
      try {
        await flushPendingSaves();
      } catch (e2) {
        setError(e2.message);
        return;
      }
    }
    navigate(to, navState ? { state: navState } : undefined);
  };

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

  // Kept in the part's operation order (by name) so the saved snapshot
  // compares equal regardless of click order. Ticking any operation is what
  // turns requires_in_process on -- the backend derives it the same way.
  const handleRequiredOperationToggle = (operationId, checked) => {
    setHeader((prev) => {
      const picked = new Set(prev.required_operation_ids ?? []);
      if (checked) picked.add(operationId);
      else picked.delete(operationId);
      const ids = inspection.operator_operations.filter((o) => picked.has(o.id)).map((o) => o.id);
      return { ...prev, requires_in_process: ids.length > 0, required_operation_ids: ids };
    });
  };

  const handleHeaderChange = (field, value) => {
    setHeader((prev) => ({ ...prev, [field]: value }));

    // Typing a sampling plan n= grows the Measurements grid to match, so the
    // inspector doesn't have to click "+ Add Sample" n times by hand. It also
    // shrinks the grid back down when n is lowered, but only by dropping
    // trailing rows (highest sample number first) that are still completely
    // empty -- no typed value in any column and no machine-log qty/machine
    // #/comment. A row that already carries real data is never auto-removed,
    // no matter how low n is edited down to; the inspector has to delete
    // that one by hand via the row's context menu, same as always.
    // Not in machine log mode, though: there n= is a piece count (e.g. 655 =
    // the sum of each row's Qty), while each row is one periodic log entry --
    // growing to n rows would add hundreds of empty entries.
    if (field === "sampling_plan_n" && !machineLogMode) {
      const target = Math.floor(Number(value));
      if (Number.isFinite(target) && target > 0) {
        if (samples.length < target) {
          const missing = missingSampleRows(target);
          if (missing.length > 0) {
            const allRows = [...samples, ...missing].sort((a, b) => a - b);
            setSamples(allRows);
            if (allRows.length > SAMPLE_COLLAPSE_THRESHOLD) setExpandedSamples(false);
          }
        } else if (samples.length > target) {
          const isRowEmpty = (s) => {
            const row = sampleRows[s];
            if (row && (row.qty || row.machine_number || row.comment)) return false;
            return !gridPoints.some((p) => {
              const v = values[cellKey(p.id, s)];
              return v !== undefined && v !== "";
            });
          };
          const kept = [...samples].sort((a, b) => a - b);
          while (kept.length > target && isRowEmpty(kept[kept.length - 1])) {
            kept.pop();
          }
          if (kept.length !== samples.length) setSamples(kept);
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
      setSampleRows((prev) => {
        const next = { ...prev };
        delete next[sampleNumber];
        return next;
      });
      await refreshInspection();
    } catch (e) {
      setError(e.message);
    }
  };

  const handlePhotoSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets picking the same file again re-trigger onChange
    if (!file) return;

    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const photo = await api.uploadInspectionPhoto(inspectionId, formData);
      setPhotos((prev) => [...prev, photo]);
    } catch (err) {
      setPhotoError(err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleDeletePhoto = async (photoId) => {
    if (!(await confirm("Delete this photo?"))) return;
    setPhotoError(null);
    try {
      await api.deleteInspectionPhoto(inspectionId, photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (err) {
      setPhotoError(err.message);
    }
  };

  const handleCertsSelected = async (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // lets picking the same file again re-trigger onChange
    if (files.length === 0) return;

    setUploadingCert(true);
    setCertError(null);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const cert = await api.uploadInspectionCert(inspectionId, formData);
        setCerts((prev) => [...prev, cert]);
      }
    } catch (err) {
      setCertError(err.message);
    } finally {
      setUploadingCert(false);
      api.getAuditLog(inspectionId).then(setAuditLog).catch(() => {});
    }
  };

  const handleDeleteCert = async (cert) => {
    if (!(await confirm(`Remove cert "${cert.original_name}"?`))) return;
    setCertError(null);
    try {
      await api.deleteInspectionCert(inspectionId, cert.id);
      setCerts((prev) => prev.filter((c) => c.id !== cert.id));
      api.getAuditLog(inspectionId).then(setAuditLog).catch(() => {});
    } catch (err) {
      setCertError(err.message);
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

  const handleSampleRowChange = (sampleNumber, field, value) => {
    setSampleRows((prev) => ({
      ...prev,
      [sampleNumber]: { qty: "", machine_number: "", comment: "", ...prev[sampleNumber], [field]: value },
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
    if (machineLogMode && JSON.stringify(sampleRows) !== savedSampleRowsRef.current) {
      await saveSampleRowsNow();
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

  const handleUnlock = async () => {
    if (
      !(await confirm(
        "Reopen this signed Data Sheet for editing? It will go back to \"In Progress\" and need to be re-signed once corrected. The original signature stays in this sheet's History."
      ))
    )
      return;
    setUnlocking(true);
    setError(null);
    try {
      await api.unlockInspection(inspectionId);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setUnlocking(false);
    }
  };

  if (error && !inspection) {
    return (
      <div className="page">
        <PageNav backTo="/" backLabel="Back to Home" items={[{ label: "Home", to: "/" }, { label: "Data Sheet" }]} />
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

  const parentHref = inspection.operation_id
    ? `/parts/${inspection.part_id}/operations/${inspection.operation_id}?type=${inspection.type}`
    : `/parts/${inspection.part_id}/inspections${inspection.type !== "final" ? `?type=${inspection.type}` : ""}`;
  const partsHref = `/clients/${inspection.client_id}/parts${inspection.type !== "final" ? `?type=${inspection.type}` : ""}`;
  // Pages outside the part/operation hierarchy (dashboard Recent Activity,
  // History, WO# Lookup) pass returnTo when opening a sheet, so the back
  // arrow returns there instead of jumping into the operation's page. The
  // breadcrumbs still show the sheet's real place in the hierarchy.
  const returnTo = location.state?.returnTo;
  const backTo = returnTo?.to ?? parentHref;
  const backLabel = returnTo?.label ?? (inspection.operation_id ? "Back to Operation" : "Back to Data Sheets");

  return (
    <div className="page">
      <PageNav
        backTo={backTo}
        backLabel={backLabel}
        items={[
          { label: "Home", to: "/" },
          { label: inspection.client_name, to: partsHref },
          { label: inspection.part_number, to: parentHref },
          { label: "Data Sheet" },
        ]}
        onLinkClick={guardedNavigate}
      />
      <div className="sheet-title-row">
        <div>
          <h1>Data Sheet — {inspection.part_number} Rev {inspection.drawing_rev || "N/A"}</h1>
          <span className={`status status-${resultStatus(inspection)}`}>{resultLabel(resultStatus(inspection))}</span>
        </div>
        <div className="sheet-toolbar">
          {drawing.image_path && (
            <a
              href={`${API_ORIGIN}${drawing.image_path}`}
              target="_blank"
              rel="noreferrer"
              className="toolbar-btn"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              View Drawing
            </a>
          )}
          <Link
            to={`/inspections/${inspectionId}/sheet`}
            state={location.state}
            className="toolbar-btn"
            onClick={(e) => guardedNavigate(e, `/inspections/${inspectionId}/sheet`, location.state)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            </svg>
            View / Print
          </Link>
          <button
            type="button"
            className="toolbar-btn"
            disabled={exportingPdf}
            onClick={async () => {
              setExportingPdf(true);
              try {
                await downloadInspectionPdf(inspectionId, inspectionPdfName(inspection));
              } catch (e) {
                setError(e.message);
              } finally {
                setExportingPdf(false);
              }
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
            {exportingPdf ? "Exporting…" : "Export PDF"}
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={exportingXlsx}
            onClick={async () => {
              setExportingXlsx(true);
              try {
                await downloadInspectionXlsx(inspectionId, inspectionPdfName(inspection));
              } catch (e) {
                setError(e.message);
              } finally {
                setExportingXlsx(false);
              }
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M3 15h18" />
              <path d="M9 3v18" />
            </svg>
            {exportingXlsx ? "Exporting…" : "Export Excel"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {reminderDue != null && (
        <p className={`reinspect-countdown${reminderNow >= reminderDue ? " is-due" : ""}`}>
          {reminderNow >= reminderDue
            ? `Re-inspection due now — enter the next readings (every ${formatMinutes(inspection.reinspect_interval_minutes)}).`
            : `Next inspection due in ${formatMinutes(Math.ceil((reminderDue - reminderNow) / 60_000))}, at ${new Date(
                reminderDue
              ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (every ${formatMinutes(
                inspection.reinspect_interval_minutes
              )}).`}
        </p>
      )}

      {isLocked && (
        <p className="sign-panel">
          This Data Sheet has been signed and is now locked — it can no longer be edited. Use "Export PDF" or
          "View / Print" above to see the final record.
          {canUnlock && (
            <>
              {" "}
              <button type="button" className="link-button" onClick={handleUnlock} disabled={unlocking}>
                {unlocking ? "Reopening…" : "Unlock for editing"}
              </button>
            </>
          )}
          {!canUnlock && hasAnyRole(user, ["qc"]) && (
            <>
              {" "}
              Only {inspection.signature?.full_name || "the person who signed it"} can unlock it, or an Admin,
              Supervisor, or QA Manager.
            </>
          )}
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
          {headerFieldsFor(inspection).map(([field, label]) =>
            field === "requires_in_process" && hasPerOperationRequirement(inspection) ? (
              inspection.operator_operations.map((op) => (
                <label key={`${field}-${op.id}`} className="header-field header-field-checkbox">
                  <input
                    type="checkbox"
                    checked={(header.required_operation_ids ?? []).includes(op.id)}
                    disabled={isLocked}
                    onChange={(e) => handleRequiredOperationToggle(op.id, e.target.checked)}
                  />
                  <span className="muted">
                    {label} — <strong>{op.name}</strong>
                  </span>
                </label>
              ))
            ) : BOOLEAN_HEADER_FIELDS.includes(field) ? (
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
          {!isLocked &&
            hasTemplate &&
            (() => {
              const combined = combineStatus(measurementsStatus, machineLogMode ? sampleRowsStatus : "saved");
              return (
                statusLabel(combined) && (
                  <span className={`autosave-pill autosave-pill-${combined}`}>{statusLabel(combined)}</span>
                )
              );
            })()}
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
                      {machineLogMode && (
                        <>
                          <th>Qty</th>
                          <th>Machine #</th>
                        </>
                      )}
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
                      {machineLogMode && <th>Comment</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {hasAnySpec && (
                      <>
                        <tr className="spec-row">
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
                        <tr className="spec-row">
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
                        <tr className="spec-row">
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
                    {expandedSamples || samples.length <= SAMPLE_COLLAPSE_THRESHOLD ? (
                      <>
                        {samples.map((s, sampleIndex) => (
                          <tr
                            key={s}
                            className={`sample-row${sampleIndex % 2 === 1 ? " sample-row-alt" : ""}`}
                            onContextMenu={(e) => handleSampleContextMenu(e, s)}
                          >
                            <td>{Number.isInteger(s) ? s : s.toFixed(1)}</td>
                            {machineLogMode && (
                              <>
                                <td>
                                  {isLocked ? (
                                    <span className="locked-value">{sampleRows[s]?.qty || "—"}</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min="0"
                                      className="sample-row-qty-input"
                                      value={sampleRows[s]?.qty ?? ""}
                                      onChange={(e) => handleSampleRowChange(s, "qty", e.target.value)}
                                    />
                                  )}
                                </td>
                                <td>
                                  {isLocked ? (
                                    <span className="locked-value">{sampleRows[s]?.machine_number || "—"}</span>
                                  ) : (
                                    <input
                                      type="text"
                                      className="sample-row-machine-input"
                                      value={sampleRows[s]?.machine_number ?? ""}
                                      onChange={(e) => handleSampleRowChange(s, "machine_number", e.target.value)}
                                    />
                                  )}
                                </td>
                              </>
                            )}
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
                            {machineLogMode && (
                              <td>
                                {isLocked ? (
                                  <span className="locked-value">{sampleRows[s]?.comment || "—"}</span>
                                ) : (
                                  <input
                                    type="text"
                                    className="sample-row-comment-input"
                                    value={sampleRows[s]?.comment ?? ""}
                                    onChange={(e) => handleSampleRowChange(s, "comment", e.target.value)}
                                  />
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                        {samples.length > SAMPLE_COLLAPSE_THRESHOLD && (
                          <tr>
                            <td colSpan={gridPoints.length + 1 + (machineLogMode ? 3 : 0)} className="samples-collapse-cell">
                              <button type="button" className="link-button" onClick={() => setExpandedSamples(false)}>
                                Collapse rows
                              </button>
                            </td>
                          </tr>
                        )}
                      </>
                    ) : (
                      <tr>
                        <td colSpan={gridPoints.length + 1 + (machineLogMode ? 3 : 0)} className="samples-collapsed-cell">
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
                        <td colSpan={gridPoints.length + 1 + (machineLogMode ? 3 : 0)} className="add-row-cell-container">
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

      {inspection.type === "final" && (
        <section className="form-card">
          <div className="form-card-header">
            <h2>Photos</h2>
            {!isLocked && (
              <label className={`secondary-btn photo-upload-btn${uploadingPhoto ? " photo-upload-btn-disabled" : ""}`}>
                {uploadingPhoto ? "Uploading..." : "+ Add photo"}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelected}
                  disabled={uploadingPhoto}
                  hidden
                />
              </label>
            )}
          </div>
          {photoError && <p className="error">{photoError}</p>}
          {photos.length === 0 ? (
            <p className="muted">
              {isLocked ? "No photos attached." : "Optional — attach a photo only if this inspection needs one."}
            </p>
          ) : (
            <ul className="photo-gallery">
              {photos.map((photo) => (
                <li key={photo.id} className="photo-gallery-item">
                  <a href={`${API_ORIGIN}${photo.image_path}`} target="_blank" rel="noreferrer">
                    <img src={`${API_ORIGIN}${photo.image_path}`} alt="Inspection attachment" />
                  </a>
                  {!isLocked && (
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger photo-gallery-delete"
                      title="Delete photo"
                      onClick={() => handleDeletePhoto(photo.id)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {inspection.type === "incoming" && (
        <section className="form-card">
          <div className="form-card-header">
            <h2>Certs</h2>
            {!isLocked && (
              <label className={`secondary-btn photo-upload-btn${uploadingCert ? " photo-upload-btn-disabled" : ""}`}>
                {uploadingCert ? "Uploading..." : "+ Attach PDF"}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={handleCertsSelected}
                  disabled={uploadingCert}
                  hidden
                />
              </label>
            )}
          </div>
          {certError && <p className="error">{certError}</p>}
          {certs.length === 0 ? (
            <p className="muted">
              {isLocked ? "No certs attached." : "Attach the supplier's material cert / CoC as a PDF."}
            </p>
          ) : (
            <ul className="cert-list">
              {certs.map((cert) => (
                <li key={cert.id} className="cert-list-item">
                  <span className="cert-badge">PDF</span>
                  <span className="cert-list-body">
                    <a href={`${API_ORIGIN}${cert.file_path}`} target="_blank" rel="noreferrer">
                      {cert.original_name}
                    </a>
                    <span className="muted">
                      {cert.uploaded_by_name ? `${cert.uploaded_by_name} · ` : ""}
                      {timeAgo(cert.created_at)}
                    </span>
                  </span>
                  {!isLocked && (
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      title="Remove cert"
                      onClick={() => handleDeleteCert(cert)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
