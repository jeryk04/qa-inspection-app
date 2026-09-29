import { Link } from "react-router-dom";

function BackIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

// Home / ... / current-page trail -- lets you jump straight back to any
// earlier level (not just one step at a time like a plain back link), with
// the current page shown as plain text since there's nowhere further to
// navigate to from here. items: [{ label, to? }] -- the last item (or any
// item with no `to`) renders as plain text instead of a link.
function Breadcrumbs({ items, onLinkClick }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="breadcrumb-segment">
            {i > 0 && (
              <svg
                className="breadcrumb-sep"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            )}
            {isLast || !item.to ? (
              <span className="breadcrumb-current">{item.label}</span>
            ) : (
              <Link to={item.to} className="breadcrumb-link" onClick={onLinkClick && ((e) => onLinkClick(e, item.to))}>
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// The header row every non-Home page opens with: a bigger circular back
// button (backTo/backLabel) plus a breadcrumb trail (items) for jumping to
// any earlier level at once. See OperationsList.jsx for the original of
// this pattern -- pulled out here once Parts.jsx/Clients.jsx needed the
// same thing, so all three (and future pages) share one implementation.
//
// onLinkClick is optional: pages with unsaved local state (InspectionCapture)
// pass their own guardedNavigate(e, to) here so every link in this row --
// not just the back button -- goes through the same "save before leaving?"
// prompt instead of silently discarding an unsaved edit.
export default function PageNav({ backTo, backLabel = "Back", items, onLinkClick }) {
  return (
    <div className="page-nav">
      <Link
        to={backTo}
        className="back-icon-btn"
        aria-label={backLabel}
        onClick={onLinkClick && ((e) => onLinkClick(e, backTo))}
      >
        <BackIcon />
      </Link>
      <Breadcrumbs items={items} onLinkClick={onLinkClick} />
    </div>
  );
}
