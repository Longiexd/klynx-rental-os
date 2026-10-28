// ============================================================
// STATUS REGISTRY
//
// Single source of truth for every status "meaning" shown in
// the UI: fleet status, rental state, CRM stage, invoice/payment
// state. Every page should read colors from here instead of
// reimplementing its own status → color mapping.
//
// Colors always reference design tokens (lime / pink / danger /
// muted) — never raw hex — so a brand tweak in theme.css updates
// every badge in the app at once.
// ============================================================

export type StatusTone = "lime" | "pink" | "danger" | "muted" | "amber" | "blue" | "violet";

export type StatusMeta = {
  label: string;
  tone: StatusTone;
};

const TONE_CLASSES: Record<
  StatusTone,
  { bg: string; text: string; border: string; dot: string }
> = {
  lime: {
    bg: "bg-[var(--status-available-bg)]",
    text: "text-[var(--status-available-text)]",
    border: "border-[var(--status-available-border)]",
    dot: "bg-[var(--status-available-text)]",
  },
  pink: {
    bg: "bg-[var(--status-rented-bg)]",
    text: "text-[var(--status-rented-text)]",
    border: "border-[var(--status-rented-border)]",
    dot: "bg-[var(--status-rented-text)]",
  },
  danger: {
    bg: "bg-[var(--status-danger-bg)]",
    text: "text-[var(--status-danger-text)]",
    border: "border-[var(--status-danger-border)]",
    dot: "bg-[var(--status-danger-text)]",
  },
  muted: {
    bg: "bg-surface-secondary",
    text: "text-muted",
    border: "border-border",
    dot: "bg-muted",
  },
  amber: {
    bg: "bg-[var(--status-reserved-bg)]",
    text: "text-[var(--status-reserved-text)]",
    border: "border-[var(--status-reserved-border)]",
    dot: "bg-[var(--status-reserved-text)]",
  },
  blue: {
    bg: "bg-[var(--status-cleaning-bg)]",
    text: "text-[var(--status-cleaning-text)]",
    border: "border-[var(--status-cleaning-border)]",
    dot: "bg-[var(--status-cleaning-text)]",
  },
  violet: {
    bg: "bg-[var(--status-maintenance-bg)]",
    text: "text-[var(--status-maintenance-text)]",
    border: "border-[var(--status-maintenance-border)]",
    dot: "bg-[var(--status-maintenance-text)]",
  },
};

export function toneClasses(tone: StatusTone) {
  return TONE_CLASSES[tone];
}

// --------------------------------------------------------
// FLEET STATUS
// --------------------------------------------------------

export type FleetStatus =
  | "available"
  | "reserved"
  | "rented"
  | "returnDue"
  | "cleaning"
  | "maintenance"
  | "unavailable"
  | "inactive"
  | "unknown";

// Odoo returns fleet status in French for this deployment
// ("Disponible", "Loué", "Nettoyage"...) — matching must cover
// both French and English so this stays correct regardless of
// which language the Odoo instance is configured in.
export function getFleetStatus(vehicle: {
  status?: string | null;
  active?: boolean;
}): FleetStatus {
  if (vehicle.active === false) return "inactive";

  const raw = (vehicle.status || "").toLowerCase().trim();
  if (raw.includes("indispon") || raw.includes("unavailable")) return "unavailable";

  // Checked before the generic "loué" match below, since "retour
  // dû" doesn't contain "loué" but represents the same underlying
  // rented vehicle — just one that needs an action taken on it.
  if (
    raw.includes("retour d") ||
    raw.includes("return due") ||
    raw.includes("overdue")
  )
    return "returnDue";

  if (
    raw.includes("réserv") ||
    raw.includes("reserv")
  )
    return "reserved";

  if (raw.includes("loué") || raw.includes("loue") || raw.includes("rented"))
    return "rented";

  if (
    raw.includes("disponible") ||
    raw.includes("available") ||
    raw.includes("ready")
  )
    return "available";

  if (
    raw.includes("nettoy") ||
    raw.includes("cleaning") ||
    raw === "clean"
  )
    return "cleaning";

  if (
    raw.includes("maintenance") ||
    raw.includes("entretien") ||
    raw.includes("repair") ||
    raw.includes("répar") ||
    raw.includes("repar")
  )
    return "maintenance";

  return "unknown";
}

const FLEET_STATUS_META: Record<FleetStatus, StatusMeta> = {
  available: { label: "Available", tone: "lime" },
  reserved: { label: "Reserved", tone: "amber" },
  returnDue: { label: "Return due", tone: "danger" },
  rented: { label: "Rented", tone: "pink" },
  cleaning: { label: "Cleaning", tone: "blue" },
  maintenance: { label: "Maintenance", tone: "violet" },
  unavailable: { label: "Unavailable", tone: "danger" },
  inactive: { label: "Inactive", tone: "muted" },
  unknown: { label: "Unknown", tone: "muted" },
};

export function fleetStatusMeta(status: FleetStatus): StatusMeta {
  return FLEET_STATUS_META[status];
}

// --------------------------------------------------------
// RENTAL / SALE STATE
// --------------------------------------------------------

export type RentalState =
  | "draft"
  | "pickup_due"
  | "return_due"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled";

export function getRentalState(sale: {
  state?: string | null;
  booking_status?: string;
  returned?: boolean;
  picked_up?: boolean;
  date_order?: string | null;
  commitment_date?: string | null;
}, now = new Date()): RentalState {
  const raw = (sale.state || "").toLowerCase();

  if (raw === "cancel" || sale.booking_status === "cancelled") return "cancelled";
  if (sale.returned) return "completed";
  if (sale.booking_status === "quotation") return "draft";
  if (sale.booking_status === "confirmed" || raw === "sale" || raw === "done") {
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (sale.picked_up) return sale.commitment_date && sale.commitment_date.slice(0, 10) < today ? "return_due" : "ongoing";
    return sale.date_order && sale.date_order.slice(0, 10) < today ? "pickup_due" : "confirmed";
  }

  return "draft";
}

const RENTAL_STATE_META: Record<RentalState, StatusMeta> = {
  draft: { label: "Quotation", tone: "muted" },
  confirmed: { label: "Reserved · awaiting pickup", tone: "amber" },
  pickup_due: { label: "Pickup due", tone: "amber" },
  return_due: { label: "Return due", tone: "danger" },
  ongoing: { label: "Ongoing", tone: "pink" },
  completed: { label: "Completed", tone: "lime" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function rentalStateMeta(state: RentalState): StatusMeta {
  return RENTAL_STATE_META[state];
}

// --------------------------------------------------------
// INVOICE / PAYMENT STATE
// --------------------------------------------------------

export type InvoiceStatus =
  | "paid"
  | "partial"
  | "unpaid"
  | "to_invoice"
  | "no_invoice";

export function getInvoiceStatus(value?: string | null): InvoiceStatus {
  const raw = (value || "").toLowerCase();

  if (raw === "paid") return "paid";
  if (raw === "partial") return "partial";
  if (raw === "not_paid" || raw === "unpaid") return "unpaid";
  if (raw === "to invoice" || raw === "to_invoice") return "to_invoice";

  return "no_invoice";
}

const INVOICE_STATUS_META: Record<InvoiceStatus, StatusMeta> = {
  paid: { label: "Paid", tone: "lime" },
  partial: { label: "Partial", tone: "pink" },
  unpaid: { label: "Unpaid", tone: "danger" },
  to_invoice: { label: "To invoice", tone: "muted" },
  no_invoice: { label: "Nothing to invoice", tone: "muted" },
};

export function invoiceStatusMeta(status: InvoiceStatus): StatusMeta {
  return INVOICE_STATUS_META[status];
}

// --------------------------------------------------------
// CRM STAGE
// --------------------------------------------------------

export function crmStageMeta(stageName?: string | null): StatusMeta {
  const raw = (stageName || "").toLowerCase();

  if (raw.includes("won")) return { label: stageName || "Won", tone: "lime" };
  if (raw.includes("lost")) return { label: stageName || "Lost", tone: "danger" };
  if (raw.includes("negotiat") || raw.includes("proposal"))
    return { label: stageName || "Negotiation", tone: "pink" };

  return { label: stageName || "New", tone: "muted" };
}
