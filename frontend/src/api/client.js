import { typeLabel, orderRefKind, orderRefValue } from "../lib/format";

// Falls back to whatever host (and scheme) loaded the page, not a hardcoded
// "http://localhost" -- so this also works when the dev server is opened
// from another device on the LAN, e.g. a tablet at https://<lan-ip>:5173,
// and matches its https since an https page can't fetch a plain-http API
// (mixed content, blocked by the browser regardless of CORS).
const BASE_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001/api`;

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

// Saves a Data Sheet export straight to the user's Downloads. Fetched here
// (with the session cookie) and handed to the browser as an in-memory blob,
// rather than linking to the API URL -- with the dev/LAN self-signed
// certificate, Edge's "Save" re-downloads that URL itself and fails with
// "Network issue". `ext` is both the API route and the file extension.
async function downloadInspectionFile(inspectionId, filename, ext, failMessage) {
  const res = await fetch(`${BASE_URL}/inspections/${inspectionId}/${ext}`, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || failMessage);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(filename || `inspection-${inspectionId}`).replace(/[\\/:*?"<>|]+/g, "-").trim()}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadInspectionPdf(inspectionId, filename) {
  return downloadInspectionFile(inspectionId, filename, "pdf", "Couldn't generate the PDF");
}

export function downloadInspectionXlsx(inspectionId, filename) {
  return downloadInspectionFile(inspectionId, filename, "xlsx", "Couldn't generate the Excel file");
}

// "918-1811-02 Final WO 9777 2026-09-21" (or "... Incoming PO 96664 ...") --
// what a saved PDF / Excel file is named. "#" is dropped since it reads oddly in a file name.
export function inspectionPdfName(inspection) {
  return [
    inspection.part_number,
    typeLabel(inspection.type),
    orderRefValue(inspection) && `${orderRefKind(inspection).replace("#", "")} ${orderRefValue(inspection)}`,
    String(inspection.date ?? "").slice(0, 10),
  ]
    .filter(Boolean)
    .join(" ");
}

export const api = {
  // Auth
  login: (username, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),
  changePassword: (current_password, new_password) =>
    request("/auth/password", { method: "PUT", body: JSON.stringify({ current_password, new_password }) }),
  updateEmail: (email) => request("/auth/email", { method: "PUT", body: JSON.stringify({ email }) }),

  // Clients
  getClients: () => request("/clients"),
  getClient: (id) => request(`/clients/${id}`),
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
  getOperations: (partId, scope) => request(`/parts/${partId}/operations${scope ? `?scope=${scope}` : ""}`),
  createOperation: (partId, data) =>
    request(`/parts/${partId}/operations`, { method: "POST", body: JSON.stringify(data) }),
  updateOperation: (partId, id, data) =>
    request(`/parts/${partId}/operations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteOperation: (partId, id) => request(`/parts/${partId}/operations/${id}`, { method: "DELETE" }),
  // Template/drawing setup per inspection type (Browse Customers)
  getPartsSetupStatus: (clientId) => request(`/parts/setup-status?client_id=${clientId}`),
  getPartSetupStatus: (partId) => request(`/parts/${partId}/setup-status`),
  getSetupSummary: (clientIds) => request(`/parts/setup-summary?client_ids=${clientIds.join(",")}`),

  // Balloon Drawings
  getDrawings: (partId) => request(`/drawings?part_id=${partId}`),
  getOperationDrawings: (operationId) => request(`/drawings?operation_id=${operationId}`),
  getDrawing: (id) => request(`/drawings/${id}`),
  getDrawingAnalytics: (id) => request(`/drawings/${id}/analytics`),
  uploadDrawing: (formData) => request("/drawings", { method: "POST", body: formData }),
  updateDrawing: (id, data) => request(`/drawings/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteDrawing: (id) => request(`/drawings/${id}`, { method: "DELETE" }),
  addPoint: (drawingId, data) =>
    request(`/drawings/${drawingId}/points`, { method: "POST", body: JSON.stringify(data) }),
  updatePoint: (pointId, data) =>
    request(`/drawings/points/${pointId}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePoint: (pointId) => request(`/drawings/points/${pointId}`, { method: "DELETE" }),
  reorderPoints: (drawingId, pointIds) =>
    request(`/drawings/${drawingId}/points/order`, { method: "PUT", body: JSON.stringify({ point_ids: pointIds }) }),

  // Inspections
  getInspections: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inspections${qs ? `?${qs}` : ""}`);
  },
  getInspection: (id) => request(`/inspections/${id}`),
  getInspectionReminders: () => request("/inspections/reminders"),
  createInspection: (data) => request("/inspections", { method: "POST", body: JSON.stringify(data) }),
  updateInspection: (id, data) => request(`/inspections/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteInspection: (id) => request(`/inspections/${id}`, { method: "DELETE" }),
  saveMeasurements: (inspectionId, measurements) =>
    request(`/inspections/${inspectionId}/measurements`, {
      method: "PUT",
      body: JSON.stringify({ measurements }),
    }),
  savePointSummaries: (inspectionId, summaries) =>
    request(`/inspections/${inspectionId}/point-summaries`, {
      method: "PUT",
      body: JSON.stringify({ summaries }),
    }),
  saveSampleRows: (inspectionId, sampleRows) =>
    request(`/inspections/${inspectionId}/sample-rows`, {
      method: "PUT",
      body: JSON.stringify({ sampleRows }),
    }),
  deleteSample: (inspectionId, sampleNumber) =>
    request(`/inspections/${inspectionId}/measurements/${sampleNumber}`, { method: "DELETE" }),
  setStatus: (inspectionId, status, signerName, reason) =>
    request(`/inspections/${inspectionId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status, signer_name: signerName, reason }),
    }),
  unlockInspection: (inspectionId) => request(`/inspections/${inspectionId}/unlock`, { method: "PUT" }),
  getAuditLog: (inspectionId) => request(`/inspections/${inspectionId}/audit`),
  getInspectionPhotos: (inspectionId) => request(`/inspections/${inspectionId}/photos`),
  uploadInspectionPhoto: (inspectionId, formData) =>
    request(`/inspections/${inspectionId}/photos`, { method: "POST", body: formData }),
  deleteInspectionPhoto: (inspectionId, photoId) =>
    request(`/inspections/${inspectionId}/photos/${photoId}`, { method: "DELETE" }),
  getInspectionCerts: (inspectionId) => request(`/inspections/${inspectionId}/certs`),
  uploadInspectionCert: (inspectionId, formData) =>
    request(`/inspections/${inspectionId}/certs`, { method: "POST", body: formData }),
  deleteInspectionCert: (inspectionId, certId) =>
    request(`/inspections/${inspectionId}/certs/${certId}`, { method: "DELETE" }),
  getStatusLookup: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inspections/status-lookup?${qs}`);
  },
  getDashboardStats: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inspections/dashboard-stats${qs ? `?${qs}` : ""}`);
  },
  getRecentActivity: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    const qs = new URLSearchParams(clean).toString();
    return request(`/inspections/recent-activity${qs ? `?${qs}` : ""}`);
  },
  getAnalytics: () => request("/inspections/analytics"),
  dismissAlert: (measurementId) =>
    request("/inspections/analytics/dismiss-alert", { method: "POST", body: JSON.stringify({ measurement_id: measurementId }) }),

  // Admin: recycle bin
  getTrash: () => request("/admin/trash"),
  restoreTrash: (id) => request(`/admin/trash/${id}/restore`, { method: "POST" }),
  purgeTrash: (id) => request(`/admin/trash/${id}`, { method: "DELETE" }),

  // QA Manager (+ admin): Inspector Performance
  getInspectorAnalytics: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    const qs = new URLSearchParams(clean).toString();
    return request(`/inspector-analytics${qs ? `?${qs}` : ""}`);
  },
  getInspectorDetail: (userId, params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    const qs = new URLSearchParams(clean).toString();
    return request(`/inspector-analytics/${userId}${qs ? `?${qs}` : ""}`);
  },

  // Admin: users
  getUsers: () => request("/admin/users"),
  createUser: (data) => request("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/admin/users/${id}`, { method: "DELETE" }),
  updateUserClients: (id, clientIds) =>
    request(`/admin/users/${id}/clients`, { method: "PUT", body: JSON.stringify({ client_ids: clientIds }) }),
};
