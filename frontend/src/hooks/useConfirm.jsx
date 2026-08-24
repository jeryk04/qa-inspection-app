import { useCallback, useRef, useState } from "react";

// A promise-based, in-app replacement for window.confirm(). window.confirm/
// alert/prompt are silently no-ops inside VS Code's Simple Browser (its
// webview iframe is sandboxed without allow-modals) -- the call returns
// immediately without ever showing a dialog, so any deletion gated on
// `if (!window.confirm(...)) return;` just silently no-ops with no error.
// Usage: const [confirm, confirmDialog] = useConfirm(); ... await confirm("...")
// and render {confirmDialog} once somewhere in the component's JSX.
export function useConfirm() {
  const [prompt, setPrompt] = useState(null); // { message }
  const resolveRef = useRef(null);

  const confirm = useCallback((message) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setPrompt({ message });
    });
  }, []);

  const settle = (result) => {
    setPrompt(null);
    resolveRef.current?.(result);
    resolveRef.current = null;
  };

  const confirmDialog = prompt ? (
    <div className="confirm-overlay" onClick={() => settle(false)}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <p>{prompt.message}</p>
        <div className="confirm-actions">
          <button type="button" className="secondary-btn" onClick={() => settle(false)}>
            Cancel
          </button>
          <button type="button" className="reject" onClick={() => settle(true)} autoFocus>
            Delete
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, confirmDialog];
}
