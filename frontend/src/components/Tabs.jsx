// A small controlled tab strip -- pill buttons, one active at a time.
// Generic (tabs: [{key, label}], active, onChange) so it isn't tied to any
// one page; the caller owns the active state and renders whichever
// section's content itself.
export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`tab-btn${active === t.key ? " tab-btn-active" : ""}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
