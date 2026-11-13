import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import PageNav from "../components/PageNav";
import { SETUP_TYPES, SUPPLIER_SETUP_TYPES, operationsListHref, setupState } from "../lib/partSetup";

const STATE_LABELS = { ready: "Set up", partial: "Partly set up", none: "Not set up" };

function TemplatePill({ item }) {
  return item.template ? (
    <span className="setup-pill setup-pill-ok">
      ✓ Template · {item.points} Find#
    </span>
  ) : (
    <span className="setup-pill setup-pill-missing">✗ No template</span>
  );
}

function DrawingPill({ item }) {
  return item.drawing ? (
    <span className="setup-pill setup-pill-ok">✓ Drawing{item.revision ? ` · Rev ${item.revision}` : ""}</span>
  ) : (
    <span className="setup-pill setup-pill-missing">✗ No drawing</span>
  );
}

// Browse Customers' landing page for one part: every inspection type's Data
// Sheet Template and drawing at a glance (Final/Incoming share one; Set-up,
// both In-Process lists and Samples have one per operation), each with a
// link straight to where it's set up.
export default function PartSetup() {
  const { partId } = useParams();
  const [searchParams] = useSearchParams();
  // Reached from Browse Suppliers (Parts.jsx's supplier mode): only the
  // Incoming template applies to a supplier's part.
  const isSupplier = searchParams.get("supplier") === "1";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getPartSetupStatus(partId)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [partId]);

  if (error) return <p className="error page">{error}</p>;
  if (!data) return <p className="page">Loading...</p>;

  const { part, status } = data;
  const partsHref = `/clients/${part.client_id}/parts?browse=1${isSupplier ? "&supplier=1" : ""}`;
  const types = isSupplier ? SUPPLIER_SETUP_TYPES : SETUP_TYPES;

  return (
    <div className="page">
      <PageNav
        backTo={partsHref}
        backLabel="Back to Parts"
        items={[
          { label: "Home", to: "/" },
          isSupplier ? { label: "Suppliers", to: "/suppliers" } : { label: "Customers", to: "/clients?browse=1" },
          { label: part.client_name, to: partsHref },
          { label: part.part_number },
        ]}
      />
      <h1>{part.part_number}</h1>
      {part.description && <p className="muted part-setup-description">{part.description}</p>}
      <p className="muted part-setup-intro">
        Data Sheet Templates and drawings for each inspection type. A template is set up once it has Find#
        columns; the drawing is the file uploaded on that template.
      </p>

      {types.map((t) => {
        const state = setupState(status, t.key);
        return (
          <section key={t.key} className="card part-setup-type">
            <div className="part-setup-type-header">
              <h2>{t.label}</h2>
              <span className={`setup-state setup-state-${state}`}>{STATE_LABELS[state]}</span>
              <div className="part-setup-type-links">
                {t.key === "final" ? (
                  <>
                    {!isSupplier && <Link to={`/parts/${part.id}/inspections`}>Final Data Sheets</Link>}
                    <Link to={`/parts/${part.id}/inspections?type=incoming`}>Incoming Data Sheets</Link>
                  </>
                ) : (
                  <Link to={operationsListHref(part.id, t)}>
                    {status[t.key].length === 0 ? "Add operations" : "Manage operations"}
                  </Link>
                )}
              </div>
            </div>

            {t.key === "final" ? (
              <div className="part-setup-row">
                <span className="part-setup-row-name">Data Sheet Template</span>
                <TemplatePill item={status.final} />
                <DrawingPill item={status.final} />
                <Link to={`/parts/${part.id}/template`} className="part-setup-row-link">
                  {status.final.template ? "Edit template" : "Set up template"}
                </Link>
              </div>
            ) : status[t.key].length === 0 ? (
              <p className="muted part-setup-empty">No operations yet.</p>
            ) : (
              status[t.key].map((op) => (
                <div key={op.id} className="part-setup-row">
                  <span className="part-setup-row-name">{op.name}</span>
                  <TemplatePill item={op} />
                  <DrawingPill item={op} />
                  <Link
                    to={`/parts/${part.id}/template?operation_id=${op.id}&type=${t.type}`}
                    className="part-setup-row-link"
                  >
                    {op.template ? "Edit template" : "Set up template"}
                  </Link>
                </div>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}
