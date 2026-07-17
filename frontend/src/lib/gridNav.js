// Lets arrow keys move focus between adjacent <input> cells in a <table>,
// like a spreadsheet. Up/Down always jump to the cell above/below. Left/Right
// only jump to the next cell once the cursor is already at that edge of the
// field's text, so normal in-field cursor movement still works while typing.
export function handleGridArrowNav(e) {
  const { key } = e;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return;

  const input = e.target;
  const cell = input.closest("td, th");
  const row = cell?.parentElement;
  if (!cell || !row) return;

  if (key === "ArrowLeft" && !atBoundary(input, "start")) return;
  if (key === "ArrowRight" && !atBoundary(input, "end")) return;

  const cellIndex = Array.prototype.indexOf.call(row.children, cell);

  if (key === "ArrowUp" || key === "ArrowDown") {
    const targetRow = key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
    const targetInput = targetRow?.children[cellIndex]?.querySelector("input");
    if (targetInput) {
      e.preventDefault();
      focusInput(targetInput);
    }
    return;
  }

  const step = key === "ArrowLeft" ? -1 : 1;
  for (let idx = cellIndex + step; idx >= 0 && idx < row.children.length; idx += step) {
    const candidateInput = row.children[idx].querySelector("input");
    if (candidateInput) {
      e.preventDefault();
      focusInput(candidateInput);
      return;
    }
  }
}

function atBoundary(input, side) {
  try {
    const { selectionStart, selectionEnd } = input;
    // type="number" inputs report null here (not an exception) rather than
    // throwing — either way, we can't tell where the cursor is, so don't
    // block cell-to-cell navigation.
    if (selectionStart == null || selectionEnd == null) return true;
    const pos = side === "start" ? 0 : input.value.length;
    return selectionStart === pos && selectionEnd === pos;
  } catch {
    return true; // selection API unsupported for this input type — don't block navigation
  }
}

function focusInput(input) {
  input.focus();
  try {
    input.select();
  } catch {
    // not all input types support select()
  }
}
