// Extracts the leading numeric portion of a string, e.g. "82°" -> "82",
// "3.1°" -> "3.1", "70.000" -> "70.000". Returns null if there's no
// parseable leading number.
export function numericPrefix(value) {
  if (value == null) return null;
  const match = String(value).match(/^-?\d*\.?\d+/);
  return match ? match[0] : null;
}

// A spec typed wrapped in parentheses, e.g. "(5.18)" -- the drawing's
// notation for a reference dimension (see balloon_points.is_reference).
export function isParenthesized(value) {
  return value != null && /^\s*\(.*\)\s*$/.test(String(value));
}

function stripParens(value) {
  return isParenthesized(value) ? String(value).trim().slice(1, -1).trim() : value;
}

// Rounds/pads a string's leading number to 3 decimals for display, keeping
// any trailing non-numeric suffix (e.g. a "°") untouched. A parenthesized
// reference value is formatted inside its parentheses: "(5.18)" -> "(5.180)".
export function formatDecimalKeepingSuffix(value, places = 3) {
  if (isParenthesized(value)) {
    const inner = formatDecimalKeepingSuffix(stripParens(value), places);
    return `(${inner})`;
  }
  const prefix = numericPrefix(value);
  if (prefix == null) return value;
  const suffix = String(value).slice(prefix.length);
  return Number(prefix).toFixed(places) + suffix;
}

// The plain number to actually store/send to the API — strips any trailing
// non-numeric suffix (e.g. a "°" is a display-only annotation, never part
// of the stored value used in tolerance comparisons) and any reference
// parentheses (tracked separately as is_reference).
export function toStoredNumber(value) {
  const prefix = numericPrefix(stripParens(value));
  return prefix == null ? null : Number(prefix);
}

// Read-only display of one stored spec value (Max/MEAN/Min) for a Find#
// point -- its decimal places, wrapped in parentheses for a reference
// dimension. Returns null when there's no value, so callers pick their own
// placeholder.
export function formatSpec(value, point) {
  if (value == null) return null;
  const text = value.toFixed(point.decimal_places ?? 3);
  return point.is_reference ? `(${text})` : text;
}
