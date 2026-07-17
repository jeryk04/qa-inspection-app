import { handleGridArrowNav } from "../lib/gridNav";
import { formatDecimalKeepingSuffix } from "../lib/numeric";

// A numeric spreadsheet-grid cell: free typing while focused; on blur, the
// leading number is rounded/padded to 3 decimal places for display, keeping
// any trailing non-numeric suffix (e.g. a "°") untouched. Plain type="text"
// rather than type="number" — number inputs reject/wipe any non-numeric
// character (so pasting "82°" clears the field entirely) and don't support
// the selection APIs arrow-key navigation relies on. Callers still convert
// to a real number (stripping any suffix) at save time.
export default function DecimalCell({ value, onChange, decimals = 3, ...rest }) {
  const handleBlur = (e) => {
    const raw = e.target.value;
    if (raw === "") return;
    onChange(formatDecimalKeepingSuffix(raw, decimals));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className="spec-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleGridArrowNav}
      {...rest}
    />
  );
}
