import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { hasAnyRole } from "../lib/roles";
import { useConfirm } from "../hooks/useConfirm";
import PageNav from "../components/PageNav";
import { resultStatus, resultLabel, formatDate, orderRefLabel } from "../lib/format";

// Matches backend/src/routes/inspections.js's requireRole("admin",
// "supervisor", "qa_manager") on DELETE /:id, and the same list in
// Inspections.jsx/OperationDetail.jsx's own guards for it. PUT /:id/unlock
// also lets QC reopen a sheet they signed themselves (signed_by_id), so QC
// gets the right-click menu on those rows, with Unlock only.
const CAN_MANAGE_ROLES = ["admin", "supervisor", "qa_manager"];

export default function InspectionHistory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = hasAnyRole(user, CAN_MANAGE_ROLES);
  const isQc = hasAnyRole(user, ["qc"]);
  const canUnlockRow = (i) => i.status !== "in_progress" && (canManage || (isQc && i.signed_by_id === user?.id));
  const [contextMenu, setContextMenu] = useState(null); // { inspection, x, y }
  const [confirm, confirmDialog] = useConfirm();
  const [clients, setClients] = useState([]);
  const [parts, setParts] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const [clientId, setClientId] = useState("");
  const [partId, setPartId] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [jobNumber, setJobNumber] = useState("");

  useEffect(() => {
    api.getClients().then(setClients).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setPartId("");
    if (!clientId) {
      setParts([]);
      return;
    }
    api.getParts(clientId).then(setParts).catch((e) => setError(e.message));
  }, [clientId]);

  const search = () => {
    setLoading(true);
    setError(null);
    const params = {};
    if (clientId) params.client_id = clientId;
    if (partId) params.part_id = partId;
    if (status) params.status = status;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (jobNumber.trim()) params.job_number = jobNumber.trim();

    api
      .getInspections(params)
      .then(setInspections)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(search, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const handleContextMenu = (e, inspection) => {
    e.preventDefault();
    setContextMenu({ inspection, x: e.clientX, y: e.clientY });
  };

  const handleDelete = async (inspection) => {
    setContextMenu(null);
    if (!(await confirm("Delete this inspection? An admin can restore it from Recently Deleted if needed."))) return;
    try {
      await api.deleteInspection(inspection.id);
      search();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleUnlock = async (inspection) => {
    setContextMenu(null);
    if (
      !(await confirm(
        "Reopen this signed Data Sheet for editing? It will go back to \"In Progress\" and need to be re-signed once corrected."
      ))
    )
      return;
    try {
      await api.unlockInspection(inspection.id);
      navigate(`/inspections/${inspection.id}`);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    search();
  };

  const clearFilters = () => {
    setClientId("");
    setPartId("");
    setStatus("");
    setDateFrom("");
    setDateTo("");
    setJobNumber("");
  };

  return (
    <div className="page">
      <PageNav backTo="/" backLabel="Back to Home" items={[{ label: "Home", to: "/" }, { label: "Inspection History" }]} />
      <h1>Inspection History</h1>

      <form className="filter-form" onSubmit={handleSubmit}>
        <input
          placeholder="Work Order #"
          value={jobNumber}
          onChange={(e) => setJobNumber(e.target.value)}
        />

        <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">All customers</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select value={partId} onChange={(e) => setPartId(e.target.value)} disabled={!clientId}>
          <option value="">All parts</option>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.part_number}
            </option>
          ))}
        </select>

        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="in_progress">In progress</option>
          <option value="approved">Approved</option>
          <option value="conditionally_approved">Conditionally approved</option>
          <option value="rejected">Rejected</option>
        </select>

        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span className="muted">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />

        <button type="submit">Search</button>
        <button type="button" className="secondary-btn" onClick={clearFilters}>
          Clear
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {canManage && !loading && (
        <p className="muted">Right-click an inspection to delete it, or to reopen a signed one for editing.</p>
      )}
      {!canManage && isQc && !loading && (
        <p className="muted">Right-click an inspection you signed to reopen it for editing.</p>
      )}
      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Part</th>
              <th>WO# / PO#</th>
              <th>Type</th>
              <th>Date</th>
              <th>By</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inspections.map((i) => (
              <tr
                key={i.id}
                onContextMenu={canManage || canUnlockRow(i) ? (e) => handleContextMenu(e, i) : undefined}
              >
                <td>{i.client_name}</td>
                <td>{i.part_number}</td>
                <td>{orderRefLabel(i) ?? "—"}</td>
                <td>{i.type}</td>
                <td>{formatDate(i.date)}</td>
                <td>{i.performed_by_name || i.created_by_name || "—"}</td>
                <td>
                  <span className={`status status-${resultStatus(i)}`}>{resultLabel(resultStatus(i))}</span>
                </td>
                <td>
                  <Link to={`/inspections/${i.id}`}>Open</Link>
                  {" · "}
                  <Link to={`/inspections/${i.id}/sheet`}>Sheet</Link>
                </td>
              </tr>
            ))}
            {inspections.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No inspections match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {contextMenu && (
        <ul className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          {canUnlockRow(contextMenu.inspection) && (
            <li onClick={() => handleUnlock(contextMenu.inspection)}>Unlock for editing</li>
          )}
          {canManage && (
            <li className="context-menu-danger" onClick={() => handleDelete(contextMenu.inspection)}>
              Delete
            </li>
          )}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
