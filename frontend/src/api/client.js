const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Clients
  getClients: () => request("/clients"),
  createClient: (data) => request("/clients", { method: "POST", body: JSON.stringify(data) }),

  // Parts
  getParts: (clientId) => request(`/parts?client_id=${clientId}`),
  createPart: (data) => request("/parts", { method: "POST", body: JSON.stringify(data) }),

  // Balloon Drawings
  getDrawings: (partId) => request(`/drawings?part_id=${partId}`),
  getDrawing: (id) => request(`/drawings/${id}`),
  uploadDrawing: (formData) => request("/drawings", { method: "POST", body: formData }),
  addPoint: (drawingId, data) =>
    request(`/drawings/${drawingId}/points`, { method: "POST", body: JSON.stringify(data) }),

  // Inspections
  getInspections: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inspections${qs ? `?${qs}` : ""}`);
  },
  getInspection: (id) => request(`/inspections/${id}`),
  createInspection: (data) => request("/inspections", { method: "POST", body: JSON.stringify(data) }),
  saveMeasurements: (inspectionId, measurements) =>
    request(`/inspections/${inspectionId}/measurements`, {
      method: "PUT",
      body: JSON.stringify({ measurements }),
    }),
  setStatus: (inspectionId, status) =>
    request(`/inspections/${inspectionId}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
};
