require("dotenv").config();
const https = require("https");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");

const requireAuth = require("./middleware/requireAuth");
const attachRole = require("./middleware/attachRole");
const requireRole = require("./middleware/requireRole");
const authRouter = require("./routes/auth");
const clientsRouter = require("./routes/clients");
const partsRouter = require("./routes/parts");
const drawingsRouter = require("./routes/drawings");
const inspectionsRouter = require("./routes/inspections");
const adminRouter = require("./routes/admin");
const inspectorAnalyticsRouter = require("./routes/inspectorAnalytics");
const { getOrCreateDevCert } = require("./lib/devCert");

const app = express();
const PORT = process.env.PORT || 3001;
// The dev server (vite-plugin-basic-ssl) serves the frontend over https so
// it can be "installed" as a standalone PWA on Android -- that makes this
// https too, since an https page can't fetch a plain-http API (mixed
// content, blocked by the browser regardless of CORS).
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://localhost:5173";

// Also allow the frontend when it's opened from another device on the local
// network (e.g. a tablet testing the shop-floor UI) -- matches
// http(s)://<private-LAN-ip>:<any port> (dev server, preview build, etc.) in
// addition to the configured origin. 192.11.x.x is the company LAN's subnet
// (not an RFC 1918 range, but that's what the shop network actually uses).
const LAN_ORIGIN_RE = /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.(168|11)\.\d{1,3}\.\d{1,3}):\d+$/;

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
app.use("/api/admin", requireAuth, attachRole, requireRole("admin"), adminRouter);
app.use("/api/inspector-analytics", requireAuth, attachRole, requireRole("qa_manager", "admin"), inspectorAnalyticsRouter);

getOrCreateDevCert().then(({ key, cert }) => {
  https.createServer({ key, cert }, app).listen(PORT, () => {
    console.log(`Inspection App API running at https://localhost:${PORT}`);
  });
});
