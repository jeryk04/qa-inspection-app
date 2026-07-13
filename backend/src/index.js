const express = require("express");
const cors = require("cors");
const path = require("path");

const clientsRouter = require("./routes/clients");
const partsRouter = require("./routes/parts");
const drawingsRouter = require("./routes/drawings");
const inspectionsRouter = require("./routes/inspections");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/clients", clientsRouter);
app.use("/api/parts", partsRouter);
app.use("/api/drawings", drawingsRouter);
app.use("/api/inspections", inspectionsRouter);

app.listen(PORT, () => {
  console.log(`QA Inspection API running at http://localhost:${PORT}`);
});
