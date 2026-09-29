import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { greeting, timeAgo, ROLE_LABELS, resultLabel, typeLabel } from "../lib/format";
import TrendLine from "../components/charts/TrendLine";
import RankedBars from "../components/charts/RankedBars";
import Meter from "../components/charts/Meter";
import PointMeasurementHistory from "../components/PointMeasurementHistory";
import Tabs from "../components/Tabs";

const INSPECTION_TYPES = [
  { key: "final", label: "Final Inspection", enabled: true, to: "/clients", icon: "clipboard" },
  { key: "in_process", label: "In-Process Inspection", enabled: true, to: "/clients?type=in_process", icon: "gear" },
  { key: "setup", label: "Set-up Inspection", enabled: true, to: "/clients?type=setup", icon: "wrench" },
  // Incoming isn't a customer picker like the other three -- it's a 3-category
  // folder picker (see IncomingInspection.jsx / lib/incoming.js).
  { key: "incoming", label: "Incoming Inspection", enabled: true, to: "/incoming", icon: "inbox" },
  // Evaluating a brand new customer or part before it's a qualified
  // production relationship -- same Customer -> Part -> Operations -> Data
  // Sheet shape as Set-up (see schema.sql's operations.scope comment), just
  // its own fully independent operations list.
  { key: "samples", label: "Samples Inspection", enabled: true, to: "/clients?type=samples", icon: "flask" },
];

const ICON_PATHS = {
  clipboard: (
    <>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 13.09H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94Z" />
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  chart: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  ),
  flask: (
    <>
      <path d="M10 2v7.31" />
      <path d="M14 9.3V2" />
      <path d="M8.5 2h7" />
      <path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
      <path d="M5.52 16h12.96" />
    </>
  ),
};

function TypeIcon({ name }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// Full-bleed blue banner every Home variant opens with -- rendered as a
// sibling of .page (not inside it) so it spans the full width of <main>
// instead of being boxed in by .page's max-width. roleView lets AdminMenu's
// callers show the role being *viewed* (adminView) rather than the
// logged-in admin's own role, matching the "Switch view" affordance.
function DashboardHero({ title, roleView }) {
  const { user } = useAuth();
  const firstName = user?.full_name?.split(" ")[0];
  const roleLabel = ROLE_LABELS[roleView];

  return (
    <div className="dashboard-hero">
      <div className="dashboard-hero-inner">
        <div>
          <p className="dashboard-greeting">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <h1>{title}</h1>
        </div>
        {roleLabel && <span className="role-badge">{roleLabel}</span>}
      </div>
    </div>
  );
}

// Last few signed (approved/rejected) Data Sheets -- see GET
// /api/inspections/dashboard-stats, which scopes this the same way as the
// counts above (company-wide for QC, mine-only for Operator).
// Who performed it: the operation's scope is authoritative for In-Process
// (Operator and QC each have their own list), otherwise the creator's role.
function performerLabel(a) {
  if (a.operation_scope === "in_process_operator") return "Operator";
  if (a.operation_scope === "in_process_qc") return "QC";
  if (a.creator_role === "operator") return "Operator";
  if (a.creator_role) return "QC";
  return null;
}

function RecentActivity({ items }) {
  const location = useLocation();
  if (!items || items.length === 0) return null;
  // Back from the Data Sheet returns here (incl. ?tab=activity), not to the
  // operation page -- see InspectionCapture's returnTo.
  const returnTo = { to: location.pathname + location.search, label: "Back to Dashboard" };
  return (
    <div className="recent-activity">
      <h2>Recent Activity</h2>
      <ul className="activity-list">
        {items.map((a) => {
          const performer = performerLabel(a);
          return (
          <li key={`${a.inspection_id}-${a.at}`} className="activity-item">
            <span className={`activity-dot activity-dot-${a.action}`} />
            <Link to={`/inspections/${a.inspection_id}`} state={{ returnTo }} className="activity-link">
              <span className="activity-main">
                <strong>{a.part_number}</strong>
                <span className="muted"> · {a.client_name}</span>
                {a.job_number && <span className="muted"> · WO# {a.job_number}</span>}
              </span>
              <span className="activity-meta">
                <span className="activity-type">{typeLabel(a.type)}</span>
                {a.operation_name && <span> · {a.operation_name}</span>}
                {performer && <span> · by {performer}</span>}
              </span>
            </Link>
            <span className={`activity-action activity-action-${a.action}`}>
              {a.action === "approved" ? "Approved" : "Rejected"}
            </span>
            <span className="activity-time muted">{timeAgo(a.at)}</span>
          </li>
          );
        })}
      </ul>
    </div>
  );
}

function QcHome() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getDashboardStats().then(setStats).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <DashboardHero title="Select Inspection Type" roleView="qc" />
      <div className="page">
        {error && <p className="error">{error}</p>}
        <div className="type-grid">
          {INSPECTION_TYPES.map((t) =>
            t.enabled ? (
              <Link key={t.key} to={t.to} className="type-card">
                <span className="type-card-icon">
                  <TypeIcon name={t.icon} />
                </span>
                <strong>{t.label}</strong>
              </Link>
            ) : (
              <div key={t.key} className="type-card type-card-disabled">
                <span className="type-card-icon">
                  <TypeIcon name={t.icon} />
                </span>
                <strong>{t.label}</strong>
                <span className="type-card-badge">Coming soon</span>
              </div>
            )
          )}
        </div>
        {stats && <RecentActivity items={stats.recentActivity} />}
      </div>
    </>
  );
}

function OperatorHome() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getDashboardStats({ mine: 1, type: "in_process" })
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <DashboardHero title="Operator Home" roleView="operator" />
      <div className="page">
        {error && <p className="error">{error}</p>}
        <div className="type-grid">
          <Link to="/clients?type=in_process" className="type-card">
            <span className="type-card-icon">
              <TypeIcon name="gear" />
            </span>
            <strong>Start in-process inspection</strong>
          </Link>
          <Link to="/status-lookup" className="type-card">
            <span className="type-card-icon">
              <TypeIcon name="search" />
            </span>
            <strong>Check approval status</strong>
          </Link>
        </div>
        {stats && <RecentActivity items={stats.recentActivity} />}
      </div>
    </>
  );
}

// All-time Data Sheet status counts -- unlike the KPI row's 7-day approved/
// rejected window, this is the full breakdown across every status,
// including conditionally-approved (which the KPI row's plain "approved"
// count folds in, matching resultStatus()'s own rule -- see backend's
// mirrored CASE in GET /inspections/analytics).
const STATUS_TONES = { in_progress: "warn", approved: "ok", conditionally_approved: "conditional", rejected: "fail" };

function StatusBreakdown({ statusBreakdown }) {
  const cards = Object.entries(statusBreakdown).map(([key, value]) => ({
    key,
    label: resultLabel(key),
    value,
    tone: STATUS_TONES[key],
  }));
  return (
    <div className="stats-strip">
      {cards.map((c) => (
        <div key={c.key} className={`stat-card stat-card-${c.tone}`}>
          <span className="stat-card-value">{c.value}</span>
          <span className="stat-card-label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// The dashboard's headline alert: the most recently FAILED point per part
// (see backend's needsAttention -- a numeric out-of-tolerance reading or a
// specless "Not OK" check, treated the same, sorted by recency and deduped
// to one row per point) -- unlike "Most Failed Points" further down (which
// ranks by all-time count), this is "what should an engineer look at right
// now," so a point that just started failing today surfaces immediately
// instead of waiting to accumulate a count. Clicking a row jumps straight
// to that part in PartAnalyticsSection below.
const ATTENTION_COLLAPSED_LIMIT = 5;

function NeedsAttention({ items, onSelectPart, onDismiss }) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return (
      <div className="attention-panel attention-panel-clear">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <div>
          <strong>Nothing needs attention right now.</strong>
          <p className="muted">Out-of-tolerance measurements will show up here as soon as they're recorded.</p>
        </div>
      </div>
    );
  }

  const visibleItems = expanded ? items : items.slice(0, ATTENTION_COLLAPSED_LIMIT);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className="attention-panel">
      <div className="attention-panel-header">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        <h2>Needs Attention</h2>
      </div>
      <ul className="attention-list">
        {visibleItems.map((item) => (
          <li
            key={item.measurement_id}
            className="attention-item"
            onClick={() => onSelectPart({ id: item.part_id, part_number: item.part_number, client_id: item.client_id })}
          >
            <button
              type="button"
              className="attention-item-dismiss"
              title="Dismiss — reappears if this point fails again"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(item.measurement_id);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            <div className="attention-item-main">
              <strong>{item.client_name}</strong>
              <span className="muted"> · {item.part_number} · Find# {item.balloon_number}</span>
            </div>
            <div className="attention-item-detail muted">
              measured <strong className="attention-value">{item.measured_value}</strong>
              {(item.max_spec != null || item.min_spec != null) && (
                <> (spec {item.min_spec ?? "—"}–{item.max_spec ?? "—"})</>
              )}
              {" · "}
              {timeAgo(item.date)}
            </div>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button type="button" className="attention-list-toggle" onClick={() => setExpanded(true)}>
          Show all {items.length}
        </button>
      )}
      {expanded && items.length > ATTENTION_COLLAPSED_LIMIT && (
        <button type="button" className="attention-list-toggle" onClick={() => setExpanded(false)}>
          Show less
        </button>
      )}
    </div>
  );
}

// The Trends tab: company-wide charts built from real measurement/
// inspection data (see backend's GET /inspections/analytics). Every chart
// degrades to an honest "not enough data yet" state instead of rendering a
// misleading empty/flat one -- see that route's own comment for why the
// data is thin right now (In-Process Inspection only just shipped).
function TrendsTab({ analytics }) {
  const topOutOfToleranceItems = analytics.topOutOfTolerance.map((p) => ({
    label: `Find# ${p.balloon_number}`,
    sublabel: `${p.part_number} · ${p.client_name}`,
    count: p.count,
    cumulativePct: p.cumulativePct,
  }));

  return (
    <>
      <StatusBreakdown statusBreakdown={analytics.statusBreakdown} />

      <div className="form-card">
        <h2>Inspection Volume — Last 30 Days</h2>
        <TrendLine data={analytics.volumeByDay} emptyMessage="No inspections dated in the last 30 days yet." />
      </div>

      <div className="form-card">
        <h2>Overall Pass Rate</h2>
        <p className="muted">Numeric out-of-tolerance readings and specless OK / Not-OK checks combined.</p>
        <Meter
          within={analytics.tolerance.within}
          outOf={analytics.tolerance.outOf}
          label="passing"
          emptyMessage="No measurements recorded yet — this fills in as Data Sheets are filled out."
        />
      </div>

      <div className="form-card">
        <h2>Most Failed Points</h2>
        <p className="muted">
          Pareto of out-of-tolerance readings and Not-OK checks, all-time — the marked threshold is where a few
          points already account for 80% of every failure recorded.
        </p>
        <RankedBars
          items={topOutOfToleranceItems}
          valueLabel="failed"
          cumulative
          emptyMessage="No failed measurements recorded yet."
        />
      </div>
    </>
  );
}

// Customer + Part# lookup as a real master-detail layout -- a browsable/
// searchable list on the left, the selected part's real measurement
// history (reusing PointMeasurementHistory.jsx) on the right, the same
// shape as a mail client or contacts app. With no search typed it defaults
// to a browse-by-customer tree (collapsed customers, expand to see their
// parts) instead of showing nothing until you type -- covers "I know the
// customer but not the exact part number." Typing a query matches customer
// name OR part number and auto-expands the matching groups. Scoped to each
// part's Final drawing (the one every part has, vs. picking one of
// possibly several operations) -- the simplest "per Customer Part#" cut,
// matching how Inspections.jsx (Final) is already this app's primary
// per-part page.
// jumpToPart (from the NeedsAttention panel above) is a { id, part_number,
// client_id } object that pre-selects a part and scrolls this section into
// view -- a new object reference each time (even re-clicking the same
// alert) is what re-triggers the effect below.
function PartAnalyticsSection({ jumpToPart }) {
  const sectionRef = useRef(null);
  const [query, setQuery] = useState("");
  const [parts, setParts] = useState([]);
  const [clients, setClients] = useState([]);
  const [expandedClients, setExpandedClients] = useState(new Set());
  const [selectedPart, setSelectedPart] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getAllParts().then(setParts).catch(() => {});
    api.getClients().then(setClients).catch(() => {});
  }, []);

  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const groupsByClient = useMemo(() => {
    const map = new Map();
    parts.forEach((p) => {
      if (!map.has(p.client_id)) map.set(p.client_id, []);
      map.get(p.client_id).push(p);
    });
    return [...map.entries()]
      .map(([clientId, clientParts]) => ({
        clientId,
        clientName: clientNameById.get(clientId) || "Unknown customer",
        parts: [...clientParts].sort((a, b) => a.part_number.localeCompare(b.part_number)),
      }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [parts, clientNameById]);

  const trimmedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!trimmedQuery) return groupsByClient;
    return groupsByClient
      .map((g) => {
        const clientMatches = g.clientName.toLowerCase().includes(trimmedQuery);
        const matchingParts = clientMatches
          ? g.parts
          : g.parts.filter((p) => p.part_number.toLowerCase().includes(trimmedQuery));
        return { ...g, parts: matchingParts };
      })
      .filter((g) => g.parts.length > 0);
  }, [groupsByClient, trimmedQuery]);

  const toggleClient = (clientId) => {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const selectPart = async (part) => {
    setSelectedPart(part);
    setDrawing(null);
    setAnalytics(null);
    setError(null);
    setLoading(true);
    try {
      const drawings = await api.getDrawings(part.id);
      if (drawings.length === 0) {
        setLoading(false);
        return;
      }
      const full = await api.getDrawing(drawings[0].id);
      setDrawing(full);
      const drawingAnalytics = await api.getDrawingAnalytics(full.id);
      setAnalytics(drawingAnalytics);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!jumpToPart) return;
    setExpandedClients((prev) => new Set(prev).add(jumpToPart.client_id));
    selectPart(jumpToPart);
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToPart]);

  return (
    <div className="part-lookup-layout" ref={sectionRef}>
      <div className="part-lookup-list">
        <div className="search-bar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Search customer or part #..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="part-lookup-groups">
          {visibleGroups.map((g) => {
            const isOpen = trimmedQuery ? true : expandedClients.has(g.clientId);
            return (
              <div key={g.clientId} className="part-lookup-customer-group">
                <button type="button" className="part-lookup-customer-toggle" onClick={() => toggleClient(g.clientId)}>
                  <svg
                    className={`part-lookup-chevron${isOpen ? " part-lookup-chevron-open" : ""}`}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                  <span>{g.clientName}</span>
                  <span className="muted part-lookup-count">{g.parts.length}</span>
                </button>
                {isOpen && (
                  <ul className="part-lookup-parts">
                    {g.parts.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className={`part-lookup-part-btn${selectedPart?.id === p.id ? " part-lookup-part-btn-active" : ""}`}
                          onClick={() => selectPart(p)}
                        >
                          {p.part_number}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {visibleGroups.length === 0 && <p className="muted">No matches.</p>}
        </div>
      </div>

      <div className="part-lookup-detail">
        {!selectedPart && <p className="muted">Select a customer or part to see its measurement history.</p>}
        {selectedPart && (
          <>
            <h3>
              {selectedPart.part_number}
              <span className="muted"> — {clientNameById.get(selectedPart.client_id) || "Unknown customer"}</span>
            </h3>
            {error && <p className="error">{error}</p>}
            {loading && <p className="muted">Loading...</p>}
            {!loading && !drawing && (
              <p className="muted">This part doesn't have a Final Data Sheet Template set up yet.</p>
            )}
            {!loading && drawing && analytics && (
              <PointMeasurementHistory points={drawing.points} analytics={analytics} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Engineer's day-to-day work is Data Sheet Templates (drawings/points/
// operations), not signing off inspections -- so unlike QC/Operator this
// dashboard isn't a work picker, it's an oversight view: how the company's
// inspections are trending, company-wide same as QcHome (no mine/type
// scoping).
const ENGINEER_TABS = [
  { key: "trends", label: "Trends" },
  { key: "lookup", label: "Part Lookup" },
  { key: "activity", label: "Recent Activity" },
];

function EngineerHome() {
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);
  const [jumpToPart, setJumpToPart] = useState(null);
  // Active tab lives in the URL (?tab=activity) so coming back from a Data
  // Sheet -- or refreshing -- reopens the same tab instead of Trends.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = ENGINEER_TABS.some((t) => t.key === tabParam) ? tabParam : "trends";
  const setTab = (key) => setSearchParams(key === "trends" ? {} : { tab: key }, { replace: true });

  useEffect(() => {
    api.getDashboardStats().then(setStats).catch((e) => setError(e.message));
    api.getAnalytics().then(setAnalytics).catch((e) => setError(e.message));
  }, []);

  // A Needs Attention row jumps to Part Lookup AND pre-selects that part --
  // switching the tab is what makes the jump land somewhere visible.
  const jumpToPartInLookup = (part) => {
    setJumpToPart(part);
    setTab("lookup");
  };

  // Dismissing is keyed to the specific measurement (see dismissed_alerts
  // in schema.sql), so it naturally stops applying the moment a newer
  // reading comes in on that point -- refetching analytics after dismiss
  // is what picks that up, same as any other action here.
  const dismissAttentionItem = (measurementId) => {
    api.dismissAlert(measurementId).then(() => {
      api.getAnalytics().then(setAnalytics).catch((e) => setError(e.message));
    }).catch((e) => setError(e.message));
  };

  return (
    <>
      <DashboardHero title={`${ROLE_LABELS.engineer} Dashboard`} roleView="engineer" />
      <div className="page page-wide">
        {error && <p className="error">{error}</p>}

        <div className="engineer-layout">
          <div className="engineer-layout-main">
            <Tabs tabs={ENGINEER_TABS} active={tab} onChange={setTab} />

            {tab === "trends" && analytics && <TrendsTab analytics={analytics} />}
            {tab === "lookup" && <PartAnalyticsSection jumpToPart={jumpToPart} />}
            {tab === "activity" && stats && <RecentActivity items={stats.recentActivity} />}
          </div>

          <div className="engineer-layout-sidebar">
            {analytics && (
              <NeedsAttention
                items={analytics.needsAttention}
                onSelectPart={jumpToPartInLookup}
                onDismiss={dismissAttentionItem}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Labels derive from ROLE_LABELS (not hand-typed here) so this can't drift
// from the same text shown everywhere else (AccountMenu's "View as",
// AdminUsers, MyAccount) the way a second hardcoded copy silently did before.
const ADMIN_VIEWS = [
  { key: "qc", label: ROLE_LABELS.qc, icon: "clipboard" },
  { key: "operator", label: ROLE_LABELS.operator, icon: "gear" },
  { key: "engineer", label: ROLE_LABELS.engineer, icon: "chart" },
];

// Lets admin enter any of the three role experiences without logging out.
// The selection lives in AppShell's adminView state (see App.jsx) so the
// header's "Switch view" control can reset it too -- not persisted anywhere,
// so a refresh always comes back here.
function AdminMenu({ onSelect }) {
  return (
    <>
      <DashboardHero title="Select View" roleView="admin" />
      <div className="page">
        <div className="type-grid">
          {ADMIN_VIEWS.map((v) => (
            <button key={v.key} type="button" className="type-card" onClick={() => onSelect(v.key)}>
              <span className="type-card-icon">
                <TypeIcon name={v.icon} />
              </span>
              <strong>{v.label}</strong>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// Post-login home screen, branched by the logged-in user's role. operator
// gets their role-specific screen unconditionally (no preview option).
// admin gets AdminMenu, which renders any of the three screens based on
// adminView, passed down from AppShell (name predates QC also getting a
// preview toggle below -- it's really just "currently previewed view",
// shared context state, not admin-exclusive despite the name). qc gets
// QcHome by default but, like admin, can switch to EngineerHome (Quality
// Analytics) via the same AccountMenu "View as" mechanism -- see
// AccountMenu.jsx's QC_VIEW_OPTIONS.
export default function Home({ adminView, setAdminView }) {
  const { user } = useAuth();

  if (user?.role === "admin") {
    if (adminView === "qc") return <QcHome />;
    if (adminView === "operator") return <OperatorHome />;
    if (adminView === "engineer") return <EngineerHome />;
    return <AdminMenu onSelect={setAdminView} />;
  }

  if (user?.role === "qc") {
    return adminView === "engineer" ? <EngineerHome /> : <QcHome />;
  }

  if (user?.role === "operator") return <OperatorHome />;
  if (user?.role === "engineer") return <EngineerHome />;
  return <QcHome />;
}
