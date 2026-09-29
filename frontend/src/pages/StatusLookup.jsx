import { useState } from "react";
import { api } from "../api/client";
import PageNav from "../components/PageNav";
import { resultStatus, resultLabel } from "../lib/format";

export default function StatusLookup() {
  const [partNumber, setPartNumber] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [results, setResults] = useState(null); // null = no search run yet
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!partNumber.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = { part_number: partNumber.trim() };
      if (jobNumber.trim()) params.job_number = jobNumber.trim();
      setResults(await api.getStatusLookup(params));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <PageNav backTo="/" backLabel="Back to Home" items={[{ label: "Home", to: "/" }, { label: "Check Approval Status" }]} />
      <h1>Check Approval Status</h1>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          placeholder="Part number"
          value={partNumber}
          onChange={(e) => setPartNumber(e.target.value)}
        />
        <input
          placeholder="Job number (optional)"
          value={jobNumber}
          onChange={(e) => setJobNumber(e.target.value)}
        />
        <button type="submit" disabled={loading || !partNumber.trim()}>
          Search
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {results && results.length === 0 && <p className="muted">No matching inspections found.</p>}

      {results && results.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Part Number</th>
              <th>Job Number</th>
              <th>Type</th>
              <th>Status</th>
              <th>Date</th>
              <th>Inspector</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id}>
                <td>{r.part_number}</td>
                <td>{r.job_number || "—"}</td>
                <td>{r.type}</td>
                <td>
                  <span className={`status status-${resultStatus(r)}`}>{resultLabel(resultStatus(r))}</span>
                </td>
                <td>{r.date}</td>
                <td>{r.inspector || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
