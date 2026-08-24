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

// Also allow the frontend when it's opened from another device on the local
// network (e.g. a tablet testing the shop-floor UI) -- matches
// http(s)://<private-LAN-ip>:<any port> (dev server, preview build, etc.) in
// addition to the configured origin.
const LAN_ORIGIN_RE = /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):\d+$/;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || origin === FRONTEND_ORIGIN || LAN_ORIGIN_RE.test(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
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
