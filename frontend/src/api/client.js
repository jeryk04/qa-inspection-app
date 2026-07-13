const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error en la solicitud");
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Clientes
  getClientes: () => request("/clientes"),
  createCliente: (data) => request("/clientes", { method: "POST", body: JSON.stringify(data) }),

  // Piezas
  getPiezas: (clienteId) => request(`/piezas?cliente_id=${clienteId}`),
  createPieza: (data) => request("/piezas", { method: "POST", body: JSON.stringify(data) }),

  // Balloon Drawings
  getDrawings: (piezaId) => request(`/drawings?pieza_id=${piezaId}`),
  getDrawing: (id) => request(`/drawings/${id}`),
  uploadDrawing: (formData) => request("/drawings", { method: "POST", body: formData }),
  addPunto: (drawingId, data) =>
    request(`/drawings/${drawingId}/puntos`, { method: "POST", body: JSON.stringify(data) }),

  // Inspecciones
  getInspecciones: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inspecciones${qs ? `?${qs}` : ""}`);
  },
  getInspeccion: (id) => request(`/inspecciones/${id}`),
  createInspeccion: (data) => request("/inspecciones", { method: "POST", body: JSON.stringify(data) }),
  saveMediciones: (inspeccionId, mediciones) =>
    request(`/inspecciones/${inspeccionId}/mediciones`, {
      method: "PUT",
      body: JSON.stringify({ mediciones }),
    }),
  setEstado: (inspeccionId, estado) =>
    request(`/inspecciones/${inspeccionId}/estado`, { method: "PUT", body: JSON.stringify({ estado }) }),
};
