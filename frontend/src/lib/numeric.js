// Extracts the leading numeric portion of a string, e.g. "82°" -> "82",
// "3.1°" -> "3.1", "70.000" -> "70.000". Returns null if there's no
// parseable leading number.
export function numericPrefix(value) {
  if (value == null) return null;
  const match = String(value).match(/^-?\d*\.?\d+/);
  return match ? match[0] : null;
}

// Rounds/pads a string's leading number to 3 decimals for display, keeping
// any trailing non-numeric suffix (e.g. a "°") untouched.
export function formatDecimalKeepingSuffix(value, places = 3) {
  const prefix = numericPrefix(value);
  if (prefix == null) return value;
  const suffix = String(value).slice(prefix.length);
  return Number(prefix).toFixed(places) + suffix;
}

// The plain number to actually store/send to the API — strips any trailing
// non-numeric suffix (e.g. a "°" is a display-only annotation, never part
// of the stored value used in tolerance comparisons).
export function toStoredNumber(value) {
  const prefix = numericPrefix(value);
  return prefix == null ? null : Number(prefix);
}
