import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { resultStatus, resultLabel } from "../lib/format";

export default function InspectionHistory() {
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
      <Link to="/" className="back-link">
        ← Home
      </Link>
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
      {loading ? (
        <p>Loading...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Part</th>
              <th>WO#</th>
              <th>Type</th>
              <th>Date</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inspections.map((i) => (
              <tr key={i.id}>
                <td>{i.client_name}</td>
                <td>{i.part_number}</td>
                <td>{i.job_number || "—"}</td>
                <td>{i.type}</td>
                <td>{i.date}</td>
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
                <td colSpan={7} className="muted">
                  No inspections match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
