import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import Clientes from "./pages/Clientes";
import Piezas from "./pages/Piezas";
import Inspecciones from "./pages/Inspecciones";
import DrawingSetup from "./pages/DrawingSetup";
import InspeccionCaptura from "./pages/InspeccionCaptura";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <header className="app-header">
        <Link to="/clientes" className="brand">
          QA Inspection App
        </Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/clientes" replace />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/clientes/:clienteId/piezas" element={<Piezas />} />
          <Route path="/piezas/:piezaId/inspecciones" element={<Inspecciones />} />
          <Route path="/piezas/:piezaId/drawing" element={<DrawingSetup />} />
          <Route path="/inspecciones/:inspeccionId" element={<InspeccionCaptura />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
