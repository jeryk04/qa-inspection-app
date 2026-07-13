import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import Clients from "./pages/Clients";
import Parts from "./pages/Parts";
import Inspections from "./pages/Inspections";
import DrawingSetup from "./pages/DrawingSetup";
import InspectionCapture from "./pages/InspectionCapture";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <header className="app-header">
        <Link to="/clients" className="brand">
          QA Inspection App
        </Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/clients" replace />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:clientId/parts" element={<Parts />} />
          <Route path="/parts/:partId/inspections" element={<Inspections />} />
          <Route path="/parts/:partId/drawing" element={<DrawingSetup />} />
          <Route path="/inspections/:inspectionId" element={<InspectionCapture />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
