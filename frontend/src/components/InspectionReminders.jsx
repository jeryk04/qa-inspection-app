import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { formatMinutes, reminderDueAt } from "../lib/reminders";

const POLL_MS = 30_000;
const TICK_MS = 15_000;
const SNOOZE_MINUTES = 10;

// A short two-tone chime -- WebAudio, so there's no sound file to ship.
// Browsers block audio until the page has had a click/tap, which on a
// shop-floor tablet in use has always already happened; if not, it's
// silently skipped and the on-screen alert still shows.
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.35 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.35);
      osc.stop(ctx.currentTime + i * 0.35 + 0.32);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    // no audio available -- the visual alert is enough
  }
}

const notificationsSupported = typeof window !== "undefined" && "Notification" in window;

// In-Process re-inspection reminders (see balloon_drawings.
// reinspect_interval_minutes): a fixed stack in the corner of every page,
// so it's seen wherever the inspector is in the app -- including scrolled
// down a Data Sheet's grid. Only the logged-in user's own in-progress
// In-Process sheets (see GET /api/inspections/reminders); a sheet stops
// reminding as soon as it's signed, and its clock restarts on every save.
export default function InspectionReminders() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sheets, setSheets] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  // id -> { dueAt, until }: a snooze only covers the due time it was made
  // for, so a new reading (new due time) brings the reminder back normally.
  const [snoozed, setSnoozed] = useState({});
  const [permission, setPermission] = useState(notificationsSupported ? Notification.permission : "unsupported");
  // "<id>@<dueAt>" keys already announced (chime + desktop notification),
  // so each due time announces once, not on every poll.
  const announcedRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getInspectionReminders()
        .then((rows) => !cancelled && setSheets(rows))
        .catch(() => {}); // a missed poll just waits for the next one
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("focus", load);
    };
    // Re-poll on navigation too -- leaving a sheet right after saving
    // readings shouldn't keep showing it as due for up to POLL_MS.
  }, [location.pathname]);

  const due = sheets
    .map((s) => ({ ...s, dueAt: reminderDueAt(s.interval_minutes, s.last_reading_at) }))
    .filter((s) => s.dueAt != null && now >= s.dueAt)
    .filter((s) => {
      const snooze = snoozed[s.id];
      return !(snooze && snooze.dueAt === s.dueAt && now < snooze.until);
    });

  useEffect(() => {
    const fresh = due.filter((s) => !announcedRef.current.has(`${s.id}@${s.dueAt}`));
    if (fresh.length === 0) return;
    fresh.forEach((s) => announcedRef.current.add(`${s.id}@${s.dueAt}`));
    chime();
    if (permission === "granted") {
      fresh.forEach((s) => {
        try {
          const n = new Notification("In-Process inspection due", {
            body: [s.part_number, s.operation_name, s.job_number && `WO# ${s.job_number}`].filter(Boolean).join(" · "),
            tag: `reinspect-${s.id}`,
            icon: "/icon-192.png",
          });
          n.onclick = () => {
            window.focus();
            navigate(`/inspections/${s.id}`);
            n.close();
          };
        } catch {
          // some mobile browsers only allow notifications from a service worker
        }
      });
    }
  }, [due, permission, navigate]);

  if (due.length === 0) return null;

  const enableDesktopAlerts = () => {
    Notification.requestPermission().then(setPermission);
  };

  return (
    <div className="reinspect-stack" role="alert" aria-live="assertive">
      {due.map((s) => {
        const overdue = Math.floor((now - s.dueAt) / 60_000);
        return (
          <div key={s.id} className="reinspect-alert">
            <div className="reinspect-alert-title">In-Process inspection due</div>
            <div className="reinspect-alert-sheet">
              {s.part_number}
              {s.operation_name ? ` · ${s.operation_name}` : ""}
              {s.job_number ? ` · WO# ${s.job_number}` : ""}
            </div>
            <div className="reinspect-alert-meta">
              Every {formatMinutes(s.interval_minutes)} —{" "}
              {overdue >= 1 ? `overdue by ${formatMinutes(overdue)}` : "due now"}
            </div>
            <div className="reinspect-alert-actions">
              {location.pathname !== `/inspections/${s.id}` && (
                <button type="button" onClick={() => navigate(`/inspections/${s.id}`)}>
                  Open Data Sheet
                </button>
              )}
              <button
                type="button"
                className="secondary-btn"
                onClick={() =>
                  setSnoozed((prev) => ({ ...prev, [s.id]: { dueAt: s.dueAt, until: Date.now() + SNOOZE_MINUTES * 60_000 } }))
                }
              >
                Snooze {SNOOZE_MINUTES} min
              </button>
            </div>
          </div>
        );
      })}
      {permission === "default" && (
        <button type="button" className="secondary-btn reinspect-enable" onClick={enableDesktopAlerts}>
          Also alert me outside the app
        </button>
      )}
    </div>
  );
}
