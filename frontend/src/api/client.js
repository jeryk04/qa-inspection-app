// Falls back to whatever host loaded the page (not a hardcoded "localhost")
// so this also works when the dev server is opened from another device on
// the LAN, e.g. a tablet at http://<lan-ip>:5173.
const BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001/api`;

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || "Request failed");
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Auth
  login: (username, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),

  // Clients
  getClients: () => request("/clients"),
  createClient: (data) => request("/clients", { method: "POST", body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteClient: (id) => request(`/clients/${id}`, { method: "DELETE" }),

  // Parts
  getParts: (clientId) => request(`/parts?client_id=${clientId}`),
  getAllParts: () => request(`/parts`),
  getPart: (id) => request(`/parts/${id}`),
  createPart: (data) => request("/parts", { method: "POST", body: JSON.stringify(data) }),
  updatePart: (id, data) => request(`/parts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePart: (id) => request(`/parts/${id}`, { method: "DELETE" }),

  // Operations
  getOperations: (partId) => request(`/parts/${partId}/operations`),
  createOperation: (partId, data) =>
    request(`/parts/${partId}/operations`, { method: "POST", body: JSON.stringify(data) }),

  // Balloon Drawings
  getDrawings: (partId) => request(`/drawings?part_id=${partId}`),
  getOperationDrawings: (operationId) => request(`/drawings?operation_id=${operationId}`),
  getDrawing: (id) => request(`/drawings/${id}`),
  uploadDrawing: (formData) => request("/drawings", { method: "POST", body: formData }),
  updateDrawing: (id, data) => request(`/drawings/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteDrawing: (id) => request(`/drawings/${id}`, { method: "DELETE" }),
  addPoint: (drawingId, data) =>
    request(`/drawings/${drawingId}/points`, { method: "POST", body: JSON.stringify(data) }),
  updatePoint: (pointId, data) =>
    request(`/drawings/points/${pointId}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePoint: (pointId) => request(`/drawings/points/${pointId}`, { method: "DELETE" }),

  // Inspections
  getInspections: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inspections${qs ? `?${qs}` : ""}`);
  },
  getInspection: (id) => request(`/inspections/${id}`),
  createInspection: (data) => request("/inspections", { method: "POST", body: JSON.stringify(data) }),
  updateInspection: (id, data) => request(`/inspections/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteInspection: (id) => request(`/inspections/${id}`, { method: "DELETE" }),
  saveMeasurements: (inspectionId, measurements) =>
    request(`/inspections/${inspectionId}/measurements`, {
      method: "PUT",
      body: JSON.stringify({ measurements }),
    }),
  deleteSample: (inspectionId, sampleNumber) =>
    request(`/inspections/${inspectionId}/measurements/${sampleNumber}`, { method: "DELETE" }),
  setStatus: (inspectionId, status, signerName, reason) =>
    request(`/inspections/${inspectionId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status, signer_name: signerName, reason }),
    }),
  getAuditLog: (inspectionId) => request(`/inspections/${inspectionId}/audit`),
  getStatusLookup: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inspections/status-lookup?${qs}`);
  },
};
