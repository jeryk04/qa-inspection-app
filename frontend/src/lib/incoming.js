// Incoming Inspection isn't organized by real customer like Final/Set-up/
// In-Process -- these client "folders" were imported from three different
// source folders (F:\Inspection data\Incoming Inspection, \Subcontractor &
// Subcomponents\Subcomponent, and \...\Subcontractor) and are grouped here
// into 3 categories for the /incoming picker (see IncomingInspection.jsx /
// IncomingFolders.jsx). A handful of Subcomponent entries reuse a real
// existing customer client (e.g. Kawasaki) rather than creating a duplicate,
// so those clients serve double duty -- this lookup is what lets any page
// figure out "which category does this client belong to" from just its name,
// without threading a `category` param through every link in the chain.
export const INCOMING_MATERIAL_CLIENT_NAME = "Incoming Material";

export const INCOMING_CATEGORY_CLIENTS = {
  subcomponent: [
    "Subcomponent Part Numbers",
    "Alstom",
    // Was "Enviroment One" (typo) -- that duplicate customer row was merged
    // into "Environment One Corp", which now holds its parts.
    "Environment One Corp",
    "Kawasaki",
    "Liberty Pumps",
    "PMI",
    "Shaw Development",
    "Siemens",
    "Stadler",
    "Westcode",
    "Carbology Precision Fit",
    "Carrier - Carlyle",
    "Customer supply",
    "Daniels Mfg",
    "Elkhart ETL LLC",
    "Enfield - Eppendorf",
    "Rolen Tech",
    "Sanitary fitting",
  ],
  subcontractor: [
    "Alcaro & Alcaro Plating Co Inc",
    "Bodycote",
    "Bodycote Thermal",
    "Boyko's Metals Finishing",
    "Braddock",
    "Control Electropolishing",
    "Dhanya Eng S",
    "Die-Tech",
    "Electromax",
    "Form Cut",
    "Fusion Coatings",
    "Glyne Mfg",
    "H&M",
    "International Tool & Machine",
    "ITM",
    "KCM",
    "Litron",
    "Mechanical Precision Inc",
    "Metaline",
    "Northeast Coating Tech",
    "Precision Finishing",
    "Qindao",
    "Solar",
    "TRB",
    "Trinity",
    "Weldlogic",
    "Welton.J",
  ],
};

export const INCOMING_CATEGORY_LABELS = {
  material: "Incoming Material",
  subcomponent: "Subcomponent",
  subcontractor: "Subcontractor",
};

// Specific parts filed under a "double duty" Incoming Inspection client
// (see INCOMING_CATEGORY_CLIENTS) purely as a browsing marker for where
// material was sourced from, not a real part to inspect -- e.g. "BOYD"
// under TRB represents material sourced from the separate real customer
// "Boyd", filed here instead of creating a duplicate client. Deliberately
// hand-verified (checked each candidate's part_number against a real
// part-number pattern, cross-referenced against known company names), NOT
// algorithmically detected by matching against INCOMING_CATEGORY_CLIENTS or
// by "has zero inspections" -- almost every part in this database has zero
// inspections regardless of whether it's real, so neither signal actually
// distinguishes "browsing marker" from "real part nobody's inspected yet".
// Keyed by "ClientName:PartNumber" since IDs aren't stable/readable for a
// hand-curated list like this.
export const INCOMING_ONLY_PARTS = new Set([
  "Customer supply:E-one",
  "Customer supply:Kawasaki",
  "Customer supply:Shaw Devlopment",
  "TRB:BOYD",
]);

// Clients that exist PURELY as Incoming Inspection categorization buckets --
// not real companies, so unlike a "double duty" client (Kawasaki, TRB, etc.,
// which has real manufacturing parts too and stays visible in Final/Set-up/
// In-Process), these are hidden from that picker entirely. Confirmed by
// checking real data, not guessed: "Incoming Material"'s only actual
// inspections are all type='incoming'; "Subcomponent Part Numbers" and
// "Customer supply" are plain categorization labels (not company names)
// with zero real manufacturing usage.
export const INCOMING_ONLY_CLIENT_NAMES = new Set([
  INCOMING_MATERIAL_CLIENT_NAME,
  "Subcomponent Part Numbers",
  "Customer supply",
]);

// Returns "material" | "subcomponent" | "subcontractor" | null.
export function incomingCategoryForClientName(clientName) {
  if (clientName === INCOMING_MATERIAL_CLIENT_NAME) return "material";
  for (const [category, names] of Object.entries(INCOMING_CATEGORY_CLIENTS)) {
    if (names.includes(clientName)) return category;
  }
  return null;
}

// Where the "back" link from a client's Parts page should go when reached
// via the Incoming Inspection flow -- the material bucket has no sub-list
// page (see IncomingInspection.jsx), so it returns straight to the picker.
export function incomingBackHref(clientName) {
  const category = incomingCategoryForClientName(clientName);
  if (category === "material" || !category) return "/incoming";
  return `/incoming/${category}`;
}
