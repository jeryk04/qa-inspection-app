require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");

const requireAuth = require("./middleware/requireAuth");
const authRouter = require("./routes/auth");
const clientsRouter = require("./routes/clients");
const partsRouter = require("./routes/parts");
const drawingsRouter = require("./routes/drawings");
const inspectionsRouter = require("./routes/inspections");

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);

app.use("/api/clients", requireAuth, clientsRouter);
app.use("/api/parts", requireAuth, partsRouter);
app.use("/api/drawings", requireAuth, drawingsRouter);
app.use("/api/inspections", requireAuth, inspectionsRouter);

app.listen(PORT, () => {
  console.log(`QA Inspection API running at http://localhost:${PORT}`);
});
