import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { hasAnyRole } from "../lib/roles";
import { handleGridArrowNav } from "../lib/gridNav";
import { isParenthesized, toStoredNumber } from "../lib/numeric";
import { formatMinutes } from "../lib/reminders";
import DecimalCell from "../components/DecimalCell";
import PageNav from "../components/PageNav";
import { useConfirm } from "../hooks/useConfirm";

const API_ORIGIN = (
  import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001/api`
).replace(/\/api$/, "");

const EMPTY_SPEC = {
  balloon_number: "",
  max_spec: "",
  min_spec: "",
  mean_value: "",
  decimal_places: "3",
  is_check_column: false,
};

// Matches the server-side requireRole("qc", "admin", "engineer") guard on
// every write route in backend/src/routes/drawings.js -- the Template
// defines the tolerances every future inspection is checked against, so
// it's a QC/Engineering-controlled document, not something an operator can
// change. Operators still see every spec read-only on the Data Sheet's own
// Measurements grid, so there's no read-only mode to build here -- they
// just never need this page.
const TEMPLATE_EDIT_ROLES = ["qc", "admin", "engineer", "supervisor", "qa_manager"];

function isPdf(path) {
  return path?.toLowerCase().endsWith(".pdf");
}

// The Data Sheet Template: the fixed list of Find# columns (with their
// Max Spec/Mean/Min Spec) tied to one drawing revision of a part. Set up
// once, rarely edited again. Every inspection created for this part reuses
// this template's columns read-only — this page is the only place they can
// be added, edited, or removed.
export default function DataSheetTemplate() {
  const { partId } = useParams();
  const { user } = useAuth();
  const canEdit = hasAnyRole(user, TEMPLATE_EDIT_ROLES);
  const [searchParams] = useSearchParams();
  // Present only when reached from OperationDetail -- switches every drawing
  // fetch/create below from the part's Final bucket to this operation's
  // template bucket (see backend POST /api/drawings for the two separate
  // version sequences this maps onto).
  const operationId = searchParams.get("operation_id");
  // Carried through from whichever page linked here (OperationDetail or
  // Inspections) so the back-link below returns to the same in_process/
  // setup/incoming/final history the user came from, instead of losing that
  // context and falling back to a default that doesn't match.
  const type = searchParams.get("type") || (operationId ? "in_process" : "final");
  const [part, setPart] = useState(null);
  const [clientName, setClientName] = useState(null);
  const [operation, setOperation] = useState(null);
  const [drawings, setDrawings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const errorRef = useRef(null);
  const [revisionEdit, setRevisionEdit] = useState("");
  const [savingRevision, setSavingRevision] = useState(false);
  // Set once here at template setup (In-Process only in practice), not on
  // each Data Sheet -- every new inspection created against this drawing
  // inherits it (see POST /api/inspections), so an operator never has to
  // remember to flip a per-sheet checkbox.
  const [hundredPercent, setHundredPercent] = useState(false);
  const [savingHundredPercent, setSavingHundredPercent] = useState(false);
  // Same inheritance as hundredPercent above -- adds Qty/Machine #/Comment to
  // each sample row on the Data Sheet instead of the usual shared sampling
  // plan, for a periodic check that rotates through several machines.
  const [machineLogMode, setMachineLogMode] = useState(false);
  const [savingMachineLogMode, setSavingMachineLogMode] = useState(false);
  // In-Process re-inspection reminder: "every N minutes/hours" while a Data
  // Sheet for this operation is in progress. Blank = off. Edited as a value
  // + unit, stored as whole minutes.
  const [reminderValue, setReminderValue] = useState("");
  const [reminderUnit, setReminderUnit] = useState("hours");
  const [savingReminder, setSavingReminder] = useState(false);

  const [specEdits, setSpecEdits] = useState({}); // pointId -> { balloon_number, max_spec, min_spec, mean_value, is_check_column }
  const [newColumns, setNewColumns] = useState([]); // [{ id: <temp negative id> }, ...] — not yet persisted
  // Column order as rearranged on screen (saved + draft ids), persisted on
  // Save Template. Any column not listed yet (just added) goes at the end.
  const [columnOrder, setColumnOrder] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, side: "before" | "after" }
  const [saving, setSaving] = useState(false);
  const [pointMenu, setPointMenu] = useState(null); // { pointId, x, y }
  // Right-click a Find# column -> "Format decimals..." -- an Excel-style
  // "Format Cells" dialog instead of a dedicated always-visible Decimals
  // row eating a whole line of the grid for every column.
  const [formattingPointId, setFormattingPointId] = useState(null);
  const [decimalsInput, setDecimalsInput] = useState("");
  const nextTempId = useRef(0);
  const [confirm, confirmDialog] = useConfirm();
  // Buckets (part, or part+operation) we've already attempted to auto-provision
  // a blank drawing for — guards against React StrictMode's dev-mode
  // double-effect-invocation racing two creates for the same bucket. Keyed by
  // operationId too: this page can be visited for several different
  // operations on the same part without a full remount (same route, only the
  // ?operation_id= query string changes), so a part-only key would wrongly
  // block auto-provisioning for the second operation visited in one session.
  const provisionedRef = useRef(new Set());

  const loadList = async () => {
    try {
      let list = operationId ? await api.getOperationDrawings(operationId) : await api.getDrawings(partId);

      // No revision at all yet — provision a blank one (no image) so the
      // Find# grid is usable immediately instead of requiring an upload first.
      const provisionKey = operationId ? `operation:${operationId}` : `part:${partId}`;
      if (list.length === 0 && !provisionedRef.current.has(provisionKey)) {
        provisionedRef.current.add(provisionKey);
        const formData = new FormData();
        if (operationId) {
          formData.append("operation_id", operationId);
        } else {
          formData.append("part_id", partId);
        }
        await api.uploadDrawing(formData);
        list = operationId ? await api.getOperationDrawings(operationId) : await api.getDrawings(partId);
      }

      setDrawings(list);
      setSelectedId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    // getPart is just a read, kept regardless of role so the not-authorized
    // message below can still show the part number for context. loadList
    // is skipped for everyone else -- it can auto-provision a blank drawing
    // as a side effect (see below), which only QC/Engineering should trigger.
    api.getPart(partId).then(setPart).catch((e) => setError(e.message));
    if (operationId) {
      api
        .getOperations(partId)
        .then((ops) => setOperation(ops.find((o) => String(o.id) === operationId) ?? null))
        .catch((e) => setError(e.message));
    } else {
      setOperation(null);
    }
    if (canEdit) {
      loadList();
    }
  }, [partId, operationId, canEdit]);

  // For the breadcrumb trail only -- getPart doesn't include the client's
  // name, just its id (see OperationsList.jsx, same reasoning).
  useEffect(() => {
    if (!part?.client_id) return;
    api.getClient(part.client_id).then((c) => setClientName(c.name)).catch(() => {});
  }, [part?.client_id]);

  useEffect(() => {
    if (!selectedId) {
      setDrawing(null);
      return;
    }
    api
      .getDrawing(selectedId)
      .then((d) => {
        setDrawing(d);
        setRevisionEdit(d.revision_label ?? "");
        setHundredPercent(!!d.hundred_percent_inspection);
        setMachineLogMode(!!d.machine_log_mode);
        applyReminderState(d.reinspect_interval_minutes);
        setNewColumns([]);
        setColumnOrder(d.points.map((p) => p.id));
        const specState = {};
        d.points.forEach((p) => {
          // Reference dimensions come back as plain numbers + is_reference;
          // re-wrap them in parentheses so the cell shows what was typed.
          const spec = (v) => (v == null ? "" : p.is_reference ? `(${v})` : v);
          specState[p.id] = {
            balloon_number: p.balloon_number,
            max_spec: spec(p.max_spec),
            min_spec: spec(p.min_spec),
            mean_value: spec(p.mean_value),
            is_check_column: !!p.is_check_column,
            decimal_places: String(p.decimal_places ?? 3),
          };
        });
        setSpecEdits(specState);
      })
      .catch((e) => setError(e.message));
  }, [selectedId]);

  useEffect(() => {
    if (!pointMenu) return;
    const close = () => setPointMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [pointMenu]);

  // The error banner sits at the top of the page, but the action that most
  // often fails (right-click delete on a Find# column, e.g. one already
  // referenced by recorded measurements) happens far below the drawing
  // image -- without this, a rejected delete looks like nothing happened.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    const formData = new FormData();
    if (operationId) {
      formData.append("operation_id", operationId);
    } else {
      formData.append("part_id", partId);
    }
    formData.append("image", file);
    try {
      const created = await api.uploadDrawing(formData);
      setFile(null);
      await loadList();
      setSelectedId(created.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm("Delete this drawing revision? This can't be undone."))) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteDrawing(id);
      setSelectedId(null);
      await loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveRevision = async () => {
    setSavingRevision(true);
    setError(null);
    try {
      const updated = await api.updateDrawing(drawing.id, { revision_label: revisionEdit });
      setDrawing(updated);
      await loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingRevision(false);
    }
  };

  const handleToggleHundredPercent = async (checked) => {
    setHundredPercent(checked); // optimistic -- it's just a checkbox
    setSavingHundredPercent(true);
    setError(null);
    try {
      const updated = await api.updateDrawing(drawing.id, { hundred_percent_inspection: checked });
      setDrawing(updated);
    } catch (e) {
      setHundredPercent(!checked);
      setError(e.message);
    } finally {
      setSavingHundredPercent(false);
    }
  };

  const handleToggleMachineLogMode = async (checked) => {
    setMachineLogMode(checked); // optimistic -- it's just a checkbox
    setSavingMachineLogMode(true);
    setError(null);
    try {
      const updated = await api.updateDrawing(drawing.id, { machine_log_mode: checked });
      setDrawing(updated);
    } catch (e) {
      setMachineLogMode(!checked);
      setError(e.message);
    } finally {
      setSavingMachineLogMode(false);
    }
  };

  // Shows a whole number of hours as hours, anything else as minutes.
  const applyReminderState = (minutes) => {
    if (!minutes) {
      setReminderValue("");
      setReminderUnit("hours");
    } else if (minutes % 60 === 0) {
      setReminderValue(String(minutes / 60));
      setReminderUnit("hours");
    } else {
      setReminderValue(String(minutes));
      setReminderUnit("minutes");
    }
  };

  const handleSaveReminder = async (value = reminderValue) => {
    const trimmed = String(value).trim();
    const minutes = trimmed === "" ? null : Math.round(Number(trimmed) * (reminderUnit === "hours" ? 60 : 1));
    if (minutes !== null && !(minutes >= 1)) {
      setError("Enter how often this operation must be re-inspected, e.g. 2 hours or 30 minutes.");
      return;
    }
    setSavingReminder(true);
    setError(null);
    try {
      const updated = await api.updateDrawing(drawing.id, { reinspect_interval_minutes: minutes });
      setDrawing(updated);
      applyReminderState(updated.reinspect_interval_minutes);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingReminder(false);
    }
  };

  const handleSpecChange = (pointId, field, value) => {
    setSpecEdits((prev) => ({ ...prev, [pointId]: { ...prev[pointId], [field]: value } }));
  };

  // Whether this column captures as a pass/fail "OK / Not OK" check at
  // capture time (see isSpecless in lib/passfail.js) -- an explicit flag,
  // independent of whatever Max/MEAN/Min happen to be typed in below, so a
  // check column can still carry a documented reference spec (e.g. a
  // Go/No-Go gauge's nominal size) without switching to numeric capture.
  const isCheckColumn = (pointId) => !!specEdits[pointId]?.is_check_column;

  const handleToggleCheck = (pointId, checked) => {
    setSpecEdits((prev) => ({ ...prev, [pointId]: { ...prev[pointId], is_check_column: checked } }));
  };

  const handleAddColumn = () => {
    const tempId = --nextTempId.current;
    setNewColumns((prev) => [...prev, { id: tempId }]);
    setSpecEdits((prev) => ({ ...prev, [tempId]: { ...EMPTY_SPEC } }));
  };

  const handlePointContextMenu = (e, pointId) => {
    e.preventDefault();
    setPointMenu({ pointId, x: e.clientX, y: e.clientY });
  };

  // Moves a column to `index` in the on-screen order (index counted with the
  // moved column already taken out). Saved by Save Template.
  const moveColumn = (pointId, index) => {
    setPointMenu(null);
    const ids = allColumns.map((c) => c.id).filter((id) => id !== pointId);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, pointId);
    setColumnOrder(ids);
  };

  const columnIndex = (pointId) => allColumns.findIndex((c) => c.id === pointId);

  const handleDragOver = (e, pointId) => {
    if (dragId == null) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    if (dropTarget?.id !== pointId || dropTarget?.side !== side) setDropTarget({ id: pointId, side });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (dragId != null && dropTarget && dropTarget.id !== dragId) {
      const ids = allColumns.map((c) => c.id).filter((id) => id !== dragId);
      moveColumn(dragId, ids.indexOf(dropTarget.id) + (dropTarget.side === "after" ? 1 : 0));
    }
    setDragId(null);
    setDropTarget(null);
  };

  const openFormatDecimals = (pointId) => {
    setPointMenu(null);
    setDecimalsInput(specEdits[pointId]?.decimal_places ?? "3");
    setFormattingPointId(pointId);
  };

  const handleApplyDecimals = () => {
    const value = decimalsInput.trim();
    handleSpecChange(formattingPointId, "decimal_places", value === "" ? "3" : value);
    setFormattingPointId(null);
  };

  const handleDeletePoint = async (pointId) => {
    setPointMenu(null);
    if (pointId < 0) {
      setNewColumns((prev) => prev.filter((c) => c.id !== pointId));
      setSpecEdits((prev) => {
        const next = { ...prev };
        delete next[pointId];
        return next;
      });
      return;
    }
    if (
      !(await confirm(
        "Delete this Find# column? It's removed from this template and from new inspections. Past inspections that already recorded it keep it. This can't be undone."
      ))
    )
      return;
    try {
      await api.deletePoint(pointId);
      const refreshed = await api.getDrawing(drawing.id);
      setDrawing(refreshed);
      setSpecEdits((prev) => {
        const next = { ...prev };
        delete next[pointId];
        return next;
      });
    } catch (e) {
      // Someone/something already removed it server-side (e.g. a stale tab
      // retrying a delete that already went through) -- resync instead of
      // just complaining, since re-fetching is what actually fixes it.
      if (e.status === 404) {
        const refreshed = await api.getDrawing(drawing.id);
        setDrawing(refreshed);
        setSpecEdits((prev) => {
          const next = { ...prev };
          delete next[pointId];
          return next;
        });
        return;
      }
      setError(e.message);
    }
  };

  // Typing any of a column's specs in parentheses, e.g. "(5.18)", marks the
  // whole Find# as a reference dimension -- the number itself is stored
  // plain (see toStoredNumber) and the parentheses are shown back on display.
  const isReferenceEdit = (edit) =>
    [edit.max_spec, edit.min_spec, edit.mean_value].some(isParenthesized);

  // Single save: creates any draft columns that got a Find# label (blank
  // drafts are dropped), and persists spec/label edits on existing columns.
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const createdIds = {}; // draft temp id -> real id
      for (const col of newColumns) {
        const edit = specEdits[col.id];
        const label = edit?.balloon_number?.trim();
        if (!label) continue;
        const created = await api.addPoint(drawing.id, {
          balloon_number: label,
          max_spec: toStoredNumber(edit.max_spec),
          min_spec: toStoredNumber(edit.min_spec),
          mean_value: toStoredNumber(edit.mean_value),
          decimal_places: edit.decimal_places,
          is_check_column: edit.is_check_column,
          is_reference: isReferenceEdit(edit),
        });
        createdIds[col.id] = created.id;
      }

      await Promise.all(
        drawing.points.map((p) => {
          const edit = specEdits[p.id];
          if (!edit) return null;
          return api.updatePoint(p.id, {
            balloon_number: edit.balloon_number,
            max_spec: toStoredNumber(edit.max_spec),
            min_spec: toStoredNumber(edit.min_spec),
            mean_value: toStoredNumber(edit.mean_value),
            decimal_places: edit.decimal_places,
            is_check_column: edit.is_check_column,
            is_reference: isReferenceEdit(edit),
          });
        })
      );

      // Blank drafts were skipped above, so they drop out of the order here.
      const finalOrder = allColumns.map((c) => createdIds[c.id] ?? c.id).filter((id) => id > 0);
      if (finalOrder.length > 0) await api.reorderPoints(drawing.id, finalOrder);

      setNewColumns([]);
      const refreshed = await api.getDrawing(drawing.id);
      setDrawing(refreshed);
      setColumnOrder(refreshed.points.map((p) => p.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const fileUrl = drawing ? `${API_ORIGIN}${drawing.image_path}` : null;
  const columnsById = new Map((drawing ? [...drawing.points, ...newColumns] : []).map((c) => [c.id, c]));
  const allColumns = [
    ...columnOrder.filter((id) => columnsById.has(id)).map((id) => columnsById.get(id)),
    ...[...columnsById.values()].filter((c) => !columnOrder.includes(c.id)),
  ];
  const backTo = operationId
    ? `/parts/${partId}/operations/${operationId}?type=${type}`
    : `/parts/${partId}/inspections${type !== "final" ? `?type=${type}` : ""}`;
  const partsHref = part ? `/clients/${part.client_id}/parts${type !== "final" ? `?type=${type}` : ""}` : "/clients";
  // The "Part" breadcrumb segment is one level above backTo when there's an
  // operation involved (backTo goes straight to this one operation, but the
  // Part level should go to the Operations list, same as OperationDetail.jsx).
  // (Keeping an Operator In-Process operation on that list -- see
  // OperationsList.jsx's ?scope=.)
  const partLevelHref = operationId
    ? `/parts/${partId}/operations?type=${type}${operation?.scope === "in_process_operator" ? "&scope=in_process_operator" : ""}`
    : backTo;

  return (
    <div className="page">
      <PageNav
        backTo={backTo}
        backLabel={operationId ? "Back to Operation" : "Back to Data Sheets"}
        items={[
          { label: "Home", to: "/" },
          { label: clientName ?? "…", to: partsHref },
          { label: part?.part_number ?? `Part #${partId}`, to: partLevelHref },
          ...(operationId ? [{ label: operation?.name ?? "Operation", to: backTo }] : []),
          { label: "Data Sheet Template" },
        ]}
      />
      <h1>
        Data Sheet Template — {part?.part_number ?? `Part #${partId}`}
        {operationId ? ` / ${operation?.name ?? "Operation"}` : ""}
      </h1>
      {!canEdit ? (
        <p className="sign-panel">
          The Data Sheet Template is a QC/Engineering-controlled document — you don't have permission to view or
          edit it here. Every spec it defines is still shown read-only on this part's Data Sheet.
        </p>
      ) : (
        <>
      {error && <p className="error" ref={errorRef}>{error}</p>}

      <section className="card template-section">
        <h2>Drawing</h2>
        <p className="muted">
          Set up once per drawing revision. Every inspection for this part reuses these Find# columns automatically.
        </p>

        <form className="inline-form" onSubmit={handleUpload}>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files[0])}
          />
          <button type="submit" disabled={uploading}>
            {drawings.length === 0 ? "Upload drawing" : "Upload new revision"}
          </button>
        </form>

        {drawing && (
          <>
            <div className="inline-form">
              <label>
                Revision (as printed on the drawing):{" "}
                <input
                  className="spec-input"
                  value={revisionEdit}
                  onChange={(e) => setRevisionEdit(e.target.value)}
                  placeholder="e.g. B"
                />
              </label>
              <button type="button" onClick={handleSaveRevision} disabled={savingRevision}>
                Save revision
              </button>
            </div>

            {type === "in_process" && (
              <label className="inline-form hundred-percent-toggle">
                <input
                  type="checkbox"
                  checked={hundredPercent}
                  disabled={savingHundredPercent}
                  onChange={(e) => handleToggleHundredPercent(e.target.checked)}
                />
                100% Inspection (every piece checked, not a sampling plan) — every new Data Sheet for this operation
                starts this way automatically
              </label>
            )}

            {type === "in_process" && (
              <label className="inline-form hundred-percent-toggle">
                <input
                  type="checkbox"
                  checked={machineLogMode}
                  disabled={savingMachineLogMode}
                  onChange={(e) => handleToggleMachineLogMode(e.target.checked)}
                />
                Machine log mode (periodic check log — each sample row logs its own Qty, Machine #, and Comment) —
                every new Data Sheet for this operation starts this way automatically
              </label>
            )}

            {type === "in_process" && (
              <div className="inline-form reinspect-reminder">
                <label>
                  Re-inspection reminder: every{" "}
                  <input
                    className="spec-input"
                    type="number"
                    min="1"
                    step="any"
                    value={reminderValue}
                    onChange={(e) => setReminderValue(e.target.value)}
                    placeholder="off"
                    aria-label="Re-inspection interval"
                  />
                </label>
                <select
                  value={reminderUnit}
                  onChange={(e) => setReminderUnit(e.target.value)}
                  aria-label="Re-inspection interval unit"
                >
                  <option value="hours">hours</option>
                  <option value="minutes">minutes</option>
                </select>
                <button type="button" onClick={() => handleSaveReminder()} disabled={savingReminder}>
                  Save reminder
                </button>
                {drawing.reinspect_interval_minutes && (
                  <button
                    type="button"
                    onClick={() => handleSaveReminder("")}
                    disabled={savingReminder}
                    className="secondary-btn"
                  >
                    Turn off
                  </button>
                )}
                <span className="muted reinspect-reminder-hint">
                  {drawing.reinspect_interval_minutes
                    ? `On — every ${formatMinutes(drawing.reinspect_interval_minutes)}. `
                    : "Off. "}
                  Only runs while a Data Sheet for this operation is In Progress; the clock restarts each time
                  readings are saved.
                </span>
              </div>
            )}

            {drawing.image_path ? (
              <div className="actions-row">
                <button type="button" onClick={() => window.open(fileUrl, "_blank", "noopener,noreferrer")}>
                  View Drawing {isPdf(drawing.image_path) ? "(PDF)" : ""}
                </button>
                <button onClick={() => handleDelete(drawing.id)} disabled={deleting} className="reject">
                  Delete this revision
                </button>
              </div>
            ) : (
              <p className="muted">
                No drawing image uploaded yet for this revision — you can still set up Find# columns below, and
                upload an image any time using the form above.
              </p>
            )}
          </>
        )}
      </section>

      {drawing && (
        <section className="card template-section">
          <h2>Find# Columns ({drawing.points.length})</h2>
          <p className="muted">
            Drag a Find# column by its ⠿ handle to reorder it. Right-click a Find# column to move or delete it, or
            to set its decimal places.
          </p>
          <div className="table-scroll">
            <table className="capture-table capture-table-transposed">
              <thead>
                <tr>
                  <th>Find #</th>
                  {allColumns.map((p) => (
                    <th
                      key={p.id}
                      onContextMenu={(e) => handlePointContextMenu(e, p.id)}
                      onDragOver={(e) => handleDragOver(e, p.id)}
                      onDrop={handleDrop}
                      className={[
                        dragId === p.id ? "col-dragging" : "",
                        dropTarget?.id === p.id && dropTarget.id !== dragId ? `drop-${dropTarget.side}` : "",
                      ].join(" ")}
                    >
                      <span
                        className="col-drag-handle"
                        draggable
                        title="Drag to move this Find# column"
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(p.id)); // Firefox won't start a drag without data
                          setDragId(p.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setDropTarget(null);
                        }}
                      >
                        ⠿
                      </span>
                      <input
                        className="spec-input"
                        value={specEdits[p.id]?.balloon_number ?? ""}
                        onChange={(e) => handleSpecChange(p.id, "balloon_number", e.target.value)}
                        onKeyDown={handleGridArrowNav}
                      />
                    </th>
                  ))}
                  <th className="add-column-cell" rowSpan={6} onClick={handleAddColumn} title="Add Find#">
                    + Add Find#
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="spec-row">
                  <td>OK / Not OK</td>
                  {allColumns.map((p) => (
                    <td key={p.id} className="check-column-cell">
                      <input
                        type="checkbox"
                        checked={isCheckColumn(p.id)}
                        onChange={(e) => handleToggleCheck(p.id, e.target.checked)}
                        title="No measurement -- recorded as a pass/fail OK / Not OK check"
                      />
                    </td>
                  ))}
                </tr>
                <tr className="spec-row">
                  <td>Max Spec</td>
                  {allColumns.map((p) => (
                    <td key={p.id}>
                      <DecimalCell
                        value={specEdits[p.id]?.max_spec ?? ""}
                        onChange={(v) => handleSpecChange(p.id, "max_spec", v)}
                        decimals={Number(specEdits[p.id]?.decimal_places ?? 3)}
                      />
                    </td>
                  ))}
                </tr>
                <tr className="spec-row">
                  <td>MEAN</td>
                  {allColumns.map((p) => (
                    <td key={p.id}>
                      <DecimalCell
                        value={specEdits[p.id]?.mean_value ?? ""}
                        onChange={(v) => handleSpecChange(p.id, "mean_value", v)}
                        decimals={Number(specEdits[p.id]?.decimal_places ?? 3)}
                      />
                    </td>
                  ))}
                </tr>
                <tr className="spec-row">
                  <td>Min Spec</td>
                  {allColumns.map((p) => (
                    <td key={p.id}>
                      <DecimalCell
                        value={specEdits[p.id]?.min_spec ?? ""}
                        onChange={(v) => handleSpecChange(p.id, "min_spec", v)}
                        decimals={Number(specEdits[p.id]?.decimal_places ?? 3)}
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="actions-row">
            <button onClick={handleSave} disabled={saving}>
              Save Template
            </button>
          </div>
        </section>
      )}
        </>
      )}

      {pointMenu && (
        <ul className="context-menu" style={{ top: pointMenu.y, left: pointMenu.x }}>
          {columnIndex(pointMenu.pointId) > 0 && (
            <>
              <li onClick={() => moveColumn(pointMenu.pointId, 0)}>Move to start</li>
              <li onClick={() => moveColumn(pointMenu.pointId, columnIndex(pointMenu.pointId) - 1)}>Move left</li>
            </>
          )}
          {columnIndex(pointMenu.pointId) < allColumns.length - 1 && (
            <>
              <li onClick={() => moveColumn(pointMenu.pointId, columnIndex(pointMenu.pointId) + 1)}>Move right</li>
              <li onClick={() => moveColumn(pointMenu.pointId, allColumns.length)}>Move to end</li>
            </>
          )}
          <li onClick={() => openFormatDecimals(pointMenu.pointId)}>Format decimals…</li>
          <li className="context-menu-danger" onClick={() => handleDeletePoint(pointMenu.pointId)}>
            Delete
          </li>
        </ul>
      )}
      {formattingPointId != null && (
        <div className="confirm-overlay" onClick={() => setFormattingPointId(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>
              Decimal places for Find# "{specEdits[formattingPointId]?.balloon_number || "—"}"
            </p>
            <input
              type="number"
              min="0"
              max="6"
              className="spec-input"
              value={decimalsInput}
              onChange={(e) => setDecimalsInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApplyDecimals()}
              autoFocus
            />
            <div className="confirm-actions">
              <button type="button" className="secondary-btn" onClick={() => setFormattingPointId(null)}>
                Cancel
              </button>
              <button type="button" onClick={handleApplyDecimals}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
