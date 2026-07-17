import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { toStoredNumber } from "../lib/numeric";
import DecimalCell from "../components/DecimalCell";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const AUTOSAVE_DELAY_MS = 900;

// Only the header fields Final Inspection actually uses. Heat/Supplier/PO#/
// Operation/Customer PO# belong to Incoming Inspection (Phase 2) — the
// columns still exist in the data model for when that's built, this capture
// form just doesn't ask for them.
const HEADER_FIELDS = [
  ["quantity", "Quantity"],
  ["customer", "Customer"],
  ["job_number", "Job# / WO#"],
  ["date", "Date"],
  ["sampling_plan_n", "Sampling Plan  n="],
  ["sampling_plan_c", "c="],
  ["lot_disposition", "Lot Disposition"],
  ["inspector", "By (Inspector)"],
];

const ACTION_LABELS = {
  created: "Created",
  header_updated: "Header updated",
  measurements_saved: "Measurements saved",
  sample_deleted: "Sample deleted",
  status_changed: "Status changed",
  signed_approved: "Signed — Approved",
  signed_rejected: "Signed — Rejected",
};

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
  const [values, setValues] = useState({});
  const [auditLog, setAuditLog] = useState([]);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState("");
  const [headerStatus, setHeaderStatus] = useState("saved");
  const [notesStatus, setNotesStatus] = useState("saved");
  const [measurementsStatus, setMeasurementsStatus] = useState("saved");
  const [signingAction, setSigningAction] = useState(null); // null | "approved" | "rejected"
  const [signerName, setSignerName] = useState("");
  const [signing, setSigning] = useState(false);
  const [sampleMenu, setSampleMenu] = useState(null); // { sampleNumber, x, y }

  const isLocked = inspection ? inspection.status !== "in_progress" : false;
  const hasTemplate = drawing ? drawing.points.length > 0 : false;

  // Snapshots of what's actually been saved, so the beforeunload guard below
  // (and the autosave effects) can tell "typed but not saved" apart from
  // "matches the database".
  const savedHeaderRef = useRef("{}");
  const savedNotesRef = useRef("");
  const savedValuesRef = useRef("{}");

  const applyHeaderState = (insp) => {
    const headerState = {};
    HEADER_FIELDS.forEach(([field]) => {
      if (field === "date") {
        // "date" is stored as a full timestamp on older records — the date
        // input only accepts a plain YYYY-MM-DD value.
        headerState.date = insp.date ? insp.date.slice(0, 10) : "";
      } else if (field === "customer") {
        // Falls back to the customer folder this part lives under — the
        // customer was already chosen before the inspector ever got here.
        headerState.customer = insp.customer || insp.client_name || "";
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
    (drawing?.points || []).forEach((p) => {
      samples.forEach((s) => {
        const raw = values[cellKey(p.id, s)];
        if (raw !== "" && raw !== undefined) {
          measurements.push({ balloon_point_id: p.id, sample_number: s, measured_value: toStoredNumber(raw) });
        }
      });
    });
    await api.saveMeasurements(inspectionId, measurements);
    const insp = await refreshInspection();
    applyMeasurementState(insp);
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

  // Warn before closing/refreshing the tab if something is mid-autosave —
  // the debounce delay leaves a brief window where the very latest
  // keystroke hasn't reached the server yet.
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      const dirty =
        JSON.stringify(header) !== savedHeaderRef.current ||
        notes !== savedNotesRef.current ||
        JSON.stringify(values) !== savedValuesRef.current;
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [header, notes, values]);

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

  const handleHeaderChange = (field, value) => {
    setHeader((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddSample = () => {
    const next = samples.length > 0 ? Math.max(...samples) + 1 : 1;
    setSamples([...samples, next]);
  };

  const handleSampleContextMenu = (e, sampleNumber) => {
    e.preventDefault();
    setSampleMenu({ sampleNumber, x: e.clientX, y: e.clientY });
  };

  const handleDeleteSample = async (sampleNumber) => {
    setSampleMenu(null);
    if (!window.confirm("Are you sure you want to delete this row?")) return;
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
  };

  const cancelSigning = () => {
    setSigningAction(null);
    setSignerName("");
  };

  const confirmSigning = async () => {
    setSigning(true);
    setError(null);
    try {
      await api.setStatus(inspectionId, signingAction, signerName);
      setSigningAction(null);
      setSignerName("");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSigning(false);
    }
  };

  if (!inspection || !drawing) {
    return (
      <div className="page">
        {error && <p className="error">{error}</p>}
        <p>Loading...</p>
      </div>
    );
  }

  const measurementsByCell = Object.fromEntries(
    inspection.measurements.map((m) => [cellKey(m.balloon_point_id, m.sample_number), m])
  );

  return (
    <div className="page">
      <Link to={`/parts/${inspection.part_id}/inspections`} className="back-link">
        ← Data Sheets
      </Link>
      <h1>Data Sheet — {inspection.part_number}</h1>

      {error && <p className="error">{error}</p>}

      {isLocked && (
        <p className="sign-panel">
          This Data Sheet has been signed and is now locked — it can no longer be edited. Use "Export PDF" or
          "View / Print" below to see the final record.
        </p>
      )}

      <h2>
        Header
        {!isLocked && statusLabel(headerStatus) && (
          <span className="muted autosave-status"> · {statusLabel(headerStatus)}</span>
        )}
      </h2>
      <div className="header-grid">
        {HEADER_FIELDS.map(([field, label]) => (
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
        ))}
      </div>

      <h2>
        Measurements
        {!isLocked && hasTemplate && statusLabel(measurementsStatus) && (
          <span className="muted autosave-status"> · {statusLabel(measurementsStatus)}</span>
        )}
      </h2>

      {!hasTemplate ? (
        <p className="sign-panel">
          This part doesn't have a Data Sheet Template yet — there are no Find# columns to measure.{" "}
          <Link to={`/parts/${inspection.part_id}/template`}>Set up the Data Sheet Template</Link> first.
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="capture-table capture-table-transposed">
              <thead>
                <tr>
                  <th>Find #</th>
                  {drawing.points.map((p) => (
                    <th key={p.id}>{p.balloon_number}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="spec-row">
                  <td>Max. Spec.</td>
                  {drawing.points.map((p) => (
                    <td key={p.id}>{p.max_spec != null ? p.max_spec.toFixed(p.decimal_places ?? 3) : "—"}</td>
                  ))}
                </tr>
                <tr className="spec-row">
                  <td>MEAN</td>
                  {drawing.points.map((p) => (
                    <td key={p.id}>{p.mean_value != null ? p.mean_value.toFixed(p.decimal_places ?? 3) : "—"}</td>
                  ))}
                </tr>
                <tr className="spec-row">
                  <td>Min. Spec.</td>
                  {drawing.points.map((p) => (
                    <td key={p.id}>{p.min_spec != null ? p.min_spec.toFixed(p.decimal_places ?? 3) : "—"}</td>
                  ))}
                </tr>
                {samples.map((s) => (
                  <tr key={s} onContextMenu={(e) => handleSampleContextMenu(e, s)}>
                    <td>{Number.isInteger(s) ? s : s.toFixed(1)}</td>
                    {drawing.points.map((p) => {
                      const value = values[cellKey(p.id, s)] ?? "";
                      if (isLocked) {
                        // Frozen historical record — reflects the spec as it
                        // was when this Data Sheet was signed, even if the
                        // template's spec has since changed.
                        const measurement = measurementsByCell[cellKey(p.id, s)];
                        const within = measurement?.within_tolerance;
                        return (
                          <td key={p.id}>
                            <span className={within === 0 ? "locked-value-fail" : "locked-value"}>{value || "—"}</span>
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
                {!isLocked && (
                  <tr>
                    <td colSpan={drawing.points.length + 1} className="add-row-cell" onClick={handleAddSample}>
                      + Add Sample
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>
        Notes
        {!isLocked && statusLabel(notesStatus) && (
          <span className="muted autosave-status"> · {statusLabel(notesStatus)}</span>
        )}
      </h2>
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

      <div className="actions-row">
        {!isLocked && (
          <>
            <button onClick={() => startSigning("approved")} className="approve">
              Approve
            </button>
            <button onClick={() => startSigning("rejected")} className="reject">
              Reject
            </button>
          </>
        )}
        <Link to={`/inspections/${inspectionId}/sheet`} className="secondary-link">
          View / Print Inspection Sheet
        </Link>
        <a href={`${BASE_URL}/inspections/${inspectionId}/pdf`} target="_blank" rel="noreferrer" className="secondary-link">
          Export PDF
        </a>
      </div>

      {signingAction && (
        <div className="sign-panel">
          <p>
            Signing as <strong>{user?.full_name}</strong> to <strong>{signingAction}</strong> this inspection.
            Type your full name to confirm:
          </p>
          <div className="actions-row">
            <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Full name" />
            <button onClick={confirmSigning} disabled={signing} className="approve">
              Confirm &amp; Sign
            </button>
            <button onClick={cancelSigning} className="secondary-btn">
              Cancel
            </button>
          </div>
        </div>
      )}

      <h2>History</h2>
      <ul className="audit-log">
        {auditLog.map((entry) => (
          <li key={`${entry.action}-${entry.id}-${entry.at}`}>
            <span className="muted">{entry.at}</span> — <strong>{ACTION_LABELS[entry.action] ?? entry.action}</strong>
            {entry.user_name && <> by {entry.user_name}</>}
          </li>
        ))}
        {auditLog.length === 0 && <li className="muted">No history yet.</li>}
      </ul>

      {sampleMenu && (
        <ul className="context-menu" style={{ top: sampleMenu.y, left: sampleMenu.x }}>
          <li className="context-menu-danger" onClick={() => handleDeleteSample(sampleMenu.sampleNumber)}>
            Delete
          </li>
        </ul>
      )}
    </div>
  );
}
