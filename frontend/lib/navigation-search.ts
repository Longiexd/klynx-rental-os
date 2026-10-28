export type SearchResult = {
  id: string;
  kind: "Page" | "Action" | "Rental" | "Vehicle" | "Customer" | "Prospect" | "Invoice" | "Activity";
  label: string;
  description?: string;
  keywords?: string;
  href?: string;
  action?: "booking" | "customer";
};

const keywords: Record<string, string> = {
  "/dashboard": "home today overview accueil aujourd hui tableau de bord",
  "/dashboard/rentals": "booking bookings reservation reservations quotation quotations payment payments invoice invoices contract contracts pickup return location locations devis paiement paiements facture factures contrat contrats depart retour",
  "/dashboard/calendar": "calendar dates planning calendrier disponibilite",
  "/dashboard/customers": "customers clients contact identity licence identite permis",
  "/crm/leads": "prospects crm opportunities pipeline opportunites",
  "/dashboard/activities": "tasks reminders call email todo taches rappels appel",
  "/dashboard/fleet": "vehicles cars fleet odometer availability vehicules voitures parc kilometrage disponible",
  "/dashboard/fleet-care": "insurance documents maintenance renewals servicing tax assurance papiers entretien vidange vignette renouvellement",
  "/dashboard/analytics": "analytics revenue costs management reports statistiques revenus couts direction rapports",
  booking: "new create booking reservation quotation nouveau creer location devis",
  customer: "new create customer nouveau creer client",
};

export function matchesShortcut(item: SearchResult, query: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const text = normalize(`${item.label} ${item.description || ""} ${item.keywords || ""} ${keywords[item.href || item.action || ""] || ""}`);
  return normalize(query).trim().split(/\s+/).every(word => text.includes(word));
}
