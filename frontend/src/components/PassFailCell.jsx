import { parsePassFail, formatPassFail } from "../lib/passfail";

// The spec-less counterpart to DecimalCell -- an OK / Not OK toggle instead
// of a free-text box, for Find# points with no Max/Min spec to measure
// against (e.g. a Fixture check). Fully derived from `value` on every
// render (no local state), same as DecimalCell -- each tap/keystroke calls
// onChange straight through to the parent's `values` state, which already
// debounces the actual autosave.
export default function PassFailCell({ value, onChange }) {
  const { state, reason } = parsePassFail(value);

  return (
    <div className="passfail-cell">
      <div className="passfail-toggle">
        <button
          type="button"
          className={`passfail-btn passfail-btn-ok${state === "ok" ? " passfail-btn-active" : ""}`}
          onClick={() => onChange(formatPassFail("ok", ""))}
        >
          OK
        </button>
        <button
          type="button"
          className={`passfail-btn passfail-btn-not-ok${state === "not_ok" ? " passfail-btn-active" : ""}`}
          onClick={() => onChange(formatPassFail("not_ok", reason))}
        >
          Not OK
        </button>
      </div>
      {state === "not_ok" && (
        <input
          type="text"
          className="passfail-reason"
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => onChange(formatPassFail("not_ok", e.target.value))}
        />
      )}
    </div>
  );
}
