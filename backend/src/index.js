const express = require("express");
const cors = require("cors");
const path = require("path");

const clientesRouter = require("./routes/clientes");
const piezasRouter = require("./routes/piezas");
const drawingsRouter = require("./routes/drawings");
const inspeccionesRouter = require("./routes/inspecciones");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/clientes", clientesRouter);
app.use("/api/piezas", piezasRouter);
app.use("/api/drawings", drawingsRouter);
app.use("/api/inspecciones", inspeccionesRouter);

app.listen(PORT, () => {
  console.log(`QA Inspection API corriendo en http://localhost:${PORT}`);
});
