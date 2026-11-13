// In-Process re-inspection reminder helpers (see balloon_drawings.
// reinspect_interval_minutes in backend/src/schema.sql). Shared by the app
// shell's reminder banner and the Data Sheet's own countdown line.

// When the next inspection is due (ms since epoch), or null if this sheet
// has no reminder set.
export function reminderDueAt(intervalMinutes, lastReadingAt) {
  if (!intervalMinutes || !lastReadingAt) return null;
  const last = Date.parse(lastReadingAt);
  if (Number.isNaN(last)) return null;
  return last + intervalMinutes * 60_000;
}

// "45 min", "1 h 30 min", "2 h" -- for intervals and countdowns alike.
export function formatMinutes(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
