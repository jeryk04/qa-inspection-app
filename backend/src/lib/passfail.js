// Server-side mirror of frontend/src/lib/passfail.js's parsePassFail --
// kept in sync by hand since one's an ES module and this is CommonJS.
// Only the piece the analytics aggregation needs: which side of pass/fail
// a specless (Fixture/Visual-style) cell's stored text falls on.
const NOT_OK_PREFIX = "NOT OK";

function parsePassFailState(raw) {
  const trimmed = (raw ?? "").toString().trim();
  const upper = trimmed.toUpperCase();
  if (upper === "OK") return "ok";
  if (upper.startsWith(NOT_OK_PREFIX)) return "not_ok";
  return null;
}

module.exports = { parsePassFailState };
