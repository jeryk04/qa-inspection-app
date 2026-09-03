import { Link } from "react-router-dom";

// The "go edit this Data Sheet Template" action -- used below the primary
// Data Sheet file button on both Inspections.jsx (Final) and
// OperationDetail.jsx (Set-up/In-Process). Was a plain underlined text
// link easy to miss/misread as just a label; a labeled pill with a pencil
// icon reads as a clickable secondary action instead.
export default function TemplateEditLink({ to }) {
  return (
    <Link to={to} className="template-edit-link">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
      </svg>
      Edit Data Sheet Template
    </Link>
  );
}
