import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { handleGridArrowNav } from "../lib/gridNav";
import { toStoredNumber } from "../lib/numeric";
import DecimalCell from "../components/DecimalCell";
import { useConfirm } from "../hooks/useConfirm";

const API_ORIGIN = (import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001/api`).replace(/\/api$/, "");

const EMPTY_SPEC = { balloon_number: "", max_spec: "", min_spec: "", mean_value: "", decimal_places: "3" };

// Matches the server-side requireRole("qc", "admin", "engineer") guard on
// every write route in backend/src/routes/drawings.js -- the Template
// defines the tolerances every future inspection is checked against, so
// it's a QC/Engineering-controlled document, not something an operator can
// change. Operators still see every spec read-only on the Data Sheet's own
// Measurements grid, so there's no read-only mode to build here -- they
// just never need this page.
const TEMPLATE_EDIT_ROLES = ["qc", "admin", "engineer"];

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
  const canEdit = TEMPLATE_EDIT_ROLES.includes(user?.role);
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

  const [specEdits, setSpecEdits] = useState({}); // pointId -> { balloon_number, max_spec, min_spec, mean_value }
  // pointIds the user has explicitly un-checked "OK / Not OK" for while all
  // three specs are still blank -- without this, the checkbox (derived from
  // "are all specs blank") would immediately snap back to checked the moment
  // they unchecked it, since blank fields alone can't tell "meant to be a
  // check" apart from "numeric column, spec not typed in yet". Purely a UI
  // nicety for this editing session -- never saved, and irrelevant again the
  // instant any spec value is actually typed.
  const [forcedNumeric, setForcedNumeric] = useState(new Set());
  const [newColumns, setNewColumns] = useState([]); // [{ id: <temp negative id> }, ...] — not yet persisted
  const [saving, setSaving] = useState(false);
  const [pointMenu, setPointMenu] = useState(null); // { pointId, x, y }
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
        setNewColumns([]);
        setForcedNumeric(new Set());
        const specState = {};
        d.points.forEach((p) => {
          specState[p.id] = {
            balloon_number: p.balloon_number,
            max_spec: p.max_spec ?? "",
            min_spec: p.min_spec ?? "",
            mean_value: p.mean_value ?? "",
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

  const handleSpecChange = (pointId, field, value) => {
    setSpecEdits((prev) => ({ ...prev, [pointId]: { ...prev[pointId], [field]: value } }));
  };

  // A column with no Max/MEAN/Min spec at all is a pass/fail "OK / Not OK"
  // check at capture time (see isSpecless in lib/passfail.js) -- this just
  // makes that existing rule an explicit, editable checkbox here instead of
  // an implicit "leave everything blank" convention.
  const isCheckColumn = (pointId) => {
    const edit = specEdits[pointId];
    const blank = !edit?.max_spec && !edit?.min_spec && !edit?.mean_value;
    return blank && !forcedNumeric.has(pointId);
  };

  const handleToggleCheck = (pointId, checked) => {
    if (checked) {
      setForcedNumeric((prev) => {
        const next = new Set(prev);
        next.delete(pointId);
        return next;
      });
      setSpecEdits((prev) => ({
        ...prev,
        [pointId]: { ...prev[pointId], max_spec: "", min_spec: "", mean_value: "" },
      }));
    } else {
      setForcedNumeric((prev) => new Set(prev).add(pointId));
    }
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
    if (!(await confirm("Delete this Find# column? This can't be undone."))) return;
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

  // Single save: creates any draft columns that got a Find# label (blank
  // drafts are dropped), and persists spec/label edits on existing columns.
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const col of newColumns) {
        const edit = specEdits[col.id];
        const label = edit?.balloon_number?.trim();
        if (!label) continue;
        await api.addPoint(drawing.id, {
          balloon_number: label,
          max_spec: toStoredNumber(edit.max_spec),
          min_spec: toStoredNumber(edit.min_spec),
          mean_value: toStoredNumber(edit.mean_value),
          decimal_places: edit.decimal_places,
        });
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
          });
        })
      );

      setNewColumns([]);
      const refreshed = await api.getDrawing(drawing.id);
      setDrawing(refreshed);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const fileUrl = drawing ? `${API_ORIGIN}${drawing.image_path}` : null;
  const allColumns = drawing ? [...drawing.points, ...newColumns] : [];

  return (
    <div className="page">
      <Link
        to={
          operationId
            ? `/parts/${partId}/operations/${operationId}?type=${type}`
            : `/parts/${partId}/inspections${type !== "final" ? `?type=${type}` : ""}`
        }
        className="back-link"
      >
        {operationId ? "← Operation" : "← Data Sheets"}
      </Link>
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
      <p className="muted">
        Set up once per drawing revision. Every inspection for this part reuses these Find# columns automatically.
      </p>
      {error && <p className="error" ref={errorRef}>{error}</p>}

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

          {drawing.image_path ? (
            <>
              <div className="actions-row">
                <a href={fileUrl} target="_blank" rel="noreferrer" className="secondary-link open-full-size">
                  Open full size {isPdf(drawing.image_path) ? "(PDF)" : ""}
                </a>
                <button onClick={() => handleDelete(drawing.id)} disabled={deleting} className="reject">
                  Delete this revision
                </button>
              </div>

              {isPdf(drawing.image_path) ? (
                <>
                  <p className="muted">
                    Inline preview below may not render in every viewer (e.g. VS Code's Simple Browser). If it looks
                    blank or shows an error, use "Open full size" above — it opens the PDF directly, which every real
                    browser tab renders natively.
                  </p>
                  <embed src={fileUrl} type="application/pdf" className="drawing-preview drawing-preview-pdf" />
                </>
              ) : (
                <img src={fileUrl} alt="Balloon drawing" className="drawing-preview" />
              )}
            </>
          ) : (
            <p className="muted">
              No drawing image uploaded yet for this revision — you can still set up Find# columns below, and upload
              an image any time using the form above.
            </p>
          )}

          <h2>Find# Columns ({drawing.points.length})</h2>
          <p className="muted">Right-click a Find# column to delete it.</p>
          <div className="table-scroll">
            <table className="capture-table capture-table-transposed">
              <thead>
                <tr>
                  <th>Find #</th>
                  {allColumns.map((p) => (
                    <th key={p.id} onContextMenu={(e) => handlePointContextMenu(e, p.id)}>
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
                        disabled={isCheckColumn(p.id)}
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
                        disabled={isCheckColumn(p.id)}
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
                        disabled={isCheckColumn(p.id)}
                      />
                    </td>
                  ))}
                </tr>
                <tr className="spec-row">
                  <td>Decimals</td>
                  {allColumns.map((p) => (
                    <td key={p.id}>
                      <input
                        className="spec-input"
                        inputMode="numeric"
                        value={specEdits[p.id]?.decimal_places ?? "3"}
                        onChange={(e) => handleSpecChange(p.id, "decimal_places", e.target.value)}
                        onKeyDown={handleGridArrowNav}
                        disabled={isCheckColumn(p.id)}
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
        </>
      )}
        </>
      )}

      {pointMenu && (
        <ul className="context-menu" style={{ top: pointMenu.y, left: pointMenu.x }}>
          <li className="context-menu-danger" onClick={() => handleDeletePoint(pointMenu.pointId)}>
            Delete
          </li>
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
