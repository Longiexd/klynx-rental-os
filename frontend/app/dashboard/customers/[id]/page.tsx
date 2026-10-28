"use client";

import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  Mail,
  MapPin,
  Phone,
  Receipt,
  User,
  UserRound,
  XCircle,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DocumentsPanel from "@/components/ui/DocumentsPanel";
import { StatCard } from "@/components/ui/StatCard";
import { API_URL, apiRequest } from "@/lib/api-config";

// ============================================================
// TYPES
// ============================================================

type SalesOrder = {
  id: number;
  name: string;
  amount_total: number;
  state: string | null;
  invoice_status: string | null;
  date_order: string | null;
};

type Invoice = {
  id: number;
  name: string | null;
  state: string | null;
  amount_total: number;
  amount_residual: number;
  payment_state: string;
  invoice_date: string | null;
  due_date: string | null;
  origin: string | null;
};

type LeadHistory = {
  id: number;
  name: string;
  stage: string | null;
  salesperson: string | null;
  description: string | null;
  expected_revenue: number;
  probability: number;
  created: string | null;
};

type Customer = {
  id: number;
  partner_id: number;
  name: string;

  phone: string | null;
  email: string | null;

  address: {
    street: string | null;
    street2: string | null;
    city: string | null;
    zip: string | null;
    country: string | null;
  };

  company_name: string | null;
  vat: string | null;

  // CRM
  crm_stage: string | null;
  rental_status: string | null;

  salesperson: string | null;
  salesperson_id: number | null;

  lead_id: number;
  lead_name: string;
  description: string | null;

  expected_revenue: number;
  probability: number;

  created: string | null;
  updated: string | null;

  lead_history: LeadHistory[];

  // Sales
  sales_count: number;
  sales_total: number;
  sales_orders: SalesOrder[];

  // Invoices
  invoice_count: number;
  invoice_total: number;
  outstanding_amount: number;
  paid_invoices: number;
  unpaid_invoices: number;
  payment_status: "paid" | "unpaid" | "no_invoice";

  invoice_ids: number[];
  invoices: Invoice[];
};

// ============================================================
// API
// ============================================================

// ============================================================
// PAGE
// ============================================================

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams();

  const id = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const [customer, setCustomer] =
    useState<Customer | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [editingField, setEditingField] =
    useState<"phone" | "email" | null>(null);
  const [contactDraft, setContactDraft] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  // ============================================================
  // FETCH CUSTOMER
  // ============================================================

  const loadCustomer = React.useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError("");

      const response = await apiRequest(
        `${API_URL}/customers/${id}`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            "Customer not found."
          );
        }

        throw new Error(
          `API returned ${response.status}`
        );
      }

      const data: Customer =
        await response.json();

      setCustomer(data);
    } catch (err) {
      console.error(
        "Failed to load customer:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load customer."
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCustomer();
  }, [loadCustomer]);

  async function saveContact(field: "phone" | "email") {
    setSavingContact(true);
    try {
      const response = await apiRequest(`${API_URL}/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: contactDraft }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || `API returned ${response.status}`);
      }
      setEditingField(null);
      await loadCustomer();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to update ${field}.`);
    } finally {
      setSavingContact(false);
    }
  }

  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return (
      <main className="mx-auto max-w-[1500px] p-5 sm:p-8">
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="text-xs text-muted">
            Loading customer...
          </div>
        </div>
      </main>
    );
  }

  // ============================================================
  // ERROR
  // ============================================================

  if (error || !customer) {
    return (
      <main className="mx-auto max-w-[1500px] p-5 sm:p-8">
        <button
          onClick={() =>
            router.push("/dashboard/customers")
          }
          className="mb-6 flex items-center gap-2 text-xs text-muted transition hover:text-text"
        >
          <ArrowLeft size={14} />
          Back to customers
        </button>

        <div className="rounded-xl border border-border bg-surface p-10 text-center">
          <div className="text-sm font-medium">
            {error || "Customer not found."}
          </div>

          <p className="mt-2 text-xs text-muted">
            This customer may no longer be
            connected to CRM.
          </p>
        </div>
      </main>
    );
  }

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <main className="mx-auto max-w-[1500px] p-5 sm:p-8">

      {/* ========================================================
          BACK
      ======================================================== */}

      <button
        onClick={() =>
          router.push("/dashboard/customers")
        }
        className="mb-5 flex items-center gap-2 text-xs text-muted transition hover:text-text"
      >
        <ArrowLeft size={14} />
        Customers
      </button>

      {/* ========================================================
          HEADER
      ======================================================== */}

      <section className="rounded-xl border border-border bg-surface/80 p-5 sm:p-6">

        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">

          <div className="flex items-center gap-4">

            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#C8F065]/10 text-sm font-semibold text-lime-ink">
              {getInitials(customer.name)}
            </div>

            <div>

              <div className="flex flex-wrap items-center gap-2">

                <h1 className="font-[Syne] text-[24px] font-semibold tracking-[-0.035em]">
                  {customer.name}
                </h1>

                <RentalStatusBadge
                  status={
                    customer.rental_status
                  }
                />

              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">

                <span>
                  Contact #{customer.partner_id}
                </span>

                <span className="text-muted">
                  /
                </span>

                <span>
                  Lead #{customer.lead_id}
                </span>

                {customer.vat && (
                  <>
                    <span className="text-muted">
                      /
                    </span>

                    <span>
                      VAT {customer.vat}
                    </span>
                  </>
                )}

              </div>

            </div>

          </div>

          <div className="flex flex-wrap gap-2">

            <CRMStageBadge
              stage={customer.crm_stage}
            />

            {customer.salesperson && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-[9px] text-text-secondary">
                <UserRound size={11} />
                {customer.salesperson}
              </span>
            )}

          </div>

        </div>

      </section>

      {/* ========================================================
          OVERVIEW CARDS
      ======================================================== */}

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

        <StatCard
          icon={<BriefcaseBusiness size={15} />}
          label="Sales"
          value={formatCurrency(
            customer.sales_total
          )}
          detail={`${customer.sales_count} order${
            customer.sales_count !== 1
              ? "s"
              : ""
          }`}
        />

        <StatCard
          icon={<Receipt size={15} />}
          label="Invoices"
          value={customer.invoice_count.toString()}
          detail={formatCurrency(
            customer.invoice_total
          )}
        />

        <StatCard
          icon={<FileText size={15} />}
          label="Outstanding"
          value={formatCurrency(
            customer.outstanding_amount
          )}
          detail={
            customer.outstanding_amount > 0
              ? "amount due"
              : "fully paid"
          }
          tone={
            customer.outstanding_amount > 0
              ? "pink"
              : "lime"
          }
        />

        <StatCard
          icon={<UserRound size={15} />}
          label="Probability"
          value={`${customer.probability}%`}
          detail="Prospect opportunity"
        />

      </section>

      {/* ========================================================
          MAIN GRID
      ======================================================== */}

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">

        {/* ======================================================
            LEFT
        ====================================================== */}

        <div className="space-y-4">

          {/* ====================================================
              CRM
          ==================================================== */}

          <section className="overflow-hidden rounded-xl border border-border bg-surface/80">

            <SectionHeader
              icon={<BriefcaseBusiness size={14} />}
              title="CRM"
              subtitle="Lead and customer relationship"
            />

            <div className="grid gap-0 sm:grid-cols-2">

              <InfoItem
                label="Lead"
                value={
                  customer.lead_name ||
                  customer.lead_id.toString()
                }
              />

              <InfoItem
                label="Current stage"
                value={
                  customer.crm_stage ||
                  "No stage"
                }
                badge
              />

              <InfoItem
                label="Salesperson"
                value={
                  customer.salesperson ||
                  "Unassigned"
                }
              />

              <InfoItem
                label="Expected revenue"
                value={formatCurrency(
                  customer.expected_revenue
                )}
              />

              <InfoItem
                label="Probability"
                value={`${customer.probability}%`}
              />

              <InfoItem
                label="Created"
                value={formatDate(
                  customer.created
                )}
              />

            </div>

            {customer.description && (
              <div className="border-t border-border p-4">

                <div className="mb-2 text-[10px] uppercase tracking-wider text-muted">
                  Description
                </div>

                <p className="whitespace-pre-wrap text-xs leading-5 text-text-secondary">
                  {customer.description}
                </p>

              </div>
            )}

          </section>

          {/* ====================================================
              SALES ORDERS
          ==================================================== */}

          <section className="overflow-hidden rounded-xl border border-border bg-surface/80">

            <SectionHeader
              icon={<BriefcaseBusiness size={14} />}
              title="Sales orders"
              subtitle={`${customer.sales_count} order${
                customer.sales_count !== 1
                  ? "s"
                  : ""
              }`}
            />

            {customer.sales_orders.length ===
            0 ? (
              <EmptyState text="No sales orders." />
            ) : (
              <div className="divide-y divide-border">

                {customer.sales_orders.map(
                  (order) => (
                    <Link
                      key={order.id}
                      href={`/dashboard/rentals/${order.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-4 transition hover:bg-surface-secondary/40"
                    >

                      <div>

                        <div className="flex items-center gap-2">

                          <span className="text-xs font-medium text-text">
                            {order.name}
                          </span>

                          <OrderStatusBadge
                            status={
                              order.state
                            }
                          />

                        </div>

                        <div className="mt-1 text-[10px] text-muted">
                          {formatDate(
                            order.date_order
                          )}

                          {order.invoice_status && (
                            <>
                              {" "}
                              · Invoice{" "}
                              {
                                order.invoice_status
                              }
                            </>
                          )}
                        </div>

                      </div>

                      <div className="text-right">

                        <div className="text-xs font-medium text-text">
                          {formatCurrency(
                            order.amount_total
                          )}
                        </div>

                        <ChevronRight
                          size={14}
                          className="ml-auto mt-1 text-muted"
                        />

                      </div>

                    </Link>
                  )
                )}

              </div>
            )}

          </section>

          {/* ====================================================
              INVOICES
          ==================================================== */}

          <section className="overflow-hidden rounded-xl border border-border bg-surface/80">

            <SectionHeader
              icon={<Receipt size={14} />}
              title="Invoices"
              subtitle={`${customer.invoice_count} invoice${
                customer.invoice_count !== 1
                  ? "s"
                  : ""
              }`}
            />

            {customer.invoices.length ===
            0 ? (
              <EmptyState text="No invoices." />
            ) : (
              <div className="divide-y divide-border">

                {customer.invoices.map(
                  (invoice) => (
                    <div
                      key={invoice.id}
                      className="flex items-center justify-between gap-4 px-4 py-4 transition hover:bg-surface-secondary/40"
                    >

                      <div>

                        <div className="flex items-center gap-2">

                          <span className="text-xs font-medium text-text">
                            {invoice.name ||
                              `Invoice #${invoice.id}`}
                          </span>

                          <PaymentBadge
                            status={
                              invoice.payment_state
                            }
                          />

                        </div>

                        <div className="mt-1 text-[10px] text-muted">

                          {invoice.invoice_date
                            ? formatDate(
                                invoice.invoice_date
                              )
                            : "No date"}

                          {invoice.origin && (
                            <>
                              {" "}
                              ·{" "}
                              {
                                invoice.origin
                              }
                            </>
                          )}

                        </div>

                      </div>

                      <div className="text-right">

                        <div className="text-xs font-medium text-text">
                          {formatCurrency(
                            invoice.amount_total
                          )}
                        </div>

                        {invoice.amount_residual >
                          0 && (
                          <div className="mt-1 text-[9px] text-pink-ink">
                            Due{" "}
                            {formatCurrency(
                              invoice.amount_residual
                            )}
                          </div>
                        )}

                      </div>

                    </div>
                  )
                )}

              </div>
            )}

          </section>

        </div>

        {/* ======================================================
            RIGHT
        ====================================================== */}

        <div className="space-y-4">

          {/* ====================================================
              CONTACT
          ==================================================== */}

          <section className="overflow-hidden rounded-xl border border-border bg-surface/80">

            <SectionHeader
              icon={<User size={14} />}
              title="Contact information"
              subtitle="Contact record"
            />

            <div className="p-4">

              <ContactRow
                icon={<Phone size={13} />}
                label="Phone"
                value={
                  customer.phone ||
                  "No phone number"
                }
                editing={editingField === "phone"}
                draft={contactDraft}
                saving={savingContact}
                onDraftChange={setContactDraft}
                onEdit={() => { setEditingField("phone"); setContactDraft(customer.phone || ""); }}
                onCancel={() => setEditingField(null)}
                onSave={() => saveContact("phone")}
              />

              <ContactRow
                icon={<Mail size={13} />}
                label="Email"
                value={
                  customer.email ||
                  "No email address"
                }
                editing={editingField === "email"}
                draft={contactDraft}
                saving={savingContact}
                onDraftChange={setContactDraft}
                onEdit={() => { setEditingField("email"); setContactDraft(customer.email || ""); }}
                onCancel={() => setEditingField(null)}
                onSave={() => saveContact("email")}
              />

              <ContactRow
                icon={<MapPin size={13} />}
                label="Address"
                value={formatAddress(
                  customer.address
                )}
              />

              {customer.company_name && (
                <ContactRow
                  icon={<BriefcaseBusiness size={13} />}
                  label="Company"
                  value={
                    customer.company_name
                  }
                />
              )}

              {customer.vat && (
                <ContactRow
                  icon={<FileText size={13} />}
                  label="VAT"
                  value={customer.vat}
                />
              )}

            </div>

          </section>

          {/* ====================================================
              RENTAL STATUS
          ==================================================== */}

          <section className="rounded-xl border border-border bg-surface/80 p-5">

            <div className="flex items-center gap-2 text-[11px] text-muted">

              <CalendarDays
                size={14}
                className="text-lime-ink"
              />

              Rental status

            </div>

            <div className="mt-5">

              {customer.rental_status ? (
                <RentalStatusLarge
                  status={
                    customer.rental_status
                  }
                />
              ) : (
                <div className="text-xs text-muted">
                  No active rental status.
                </div>
              )}

            </div>

          </section>

          {/* ====================================================
              PAYMENT SUMMARY
          ==================================================== */}

          <section className="rounded-xl border border-border bg-surface/80 p-5">

            <div className="flex items-center gap-2 text-[11px] text-muted">

              <Receipt
                size={14}
                className="text-lime-ink"
              />

              Payment summary

            </div>

            <div className="mt-5 space-y-4">

              <SummaryRow
                label="Total invoiced"
                value={formatCurrency(
                  customer.invoice_total
                )}
              />

              <SummaryRow
                label="Paid invoices"
                value={customer.paid_invoices.toString()}
              />

              <SummaryRow
                label="Unpaid invoices"
                value={customer.unpaid_invoices.toString()}
              />

              <div className="border-t border-border pt-4">

                <SummaryRow
                  label="Outstanding"
                  value={formatCurrency(
                    customer.outstanding_amount
                  )}
                  highlight={
                    customer.outstanding_amount >
                    0
                  }
                />

              </div>

            </div>

          </section>

          {/* ====================================================
              CRM HISTORY
          ==================================================== */}

          <section className="overflow-hidden rounded-xl border border-border bg-surface/80">

            <SectionHeader
              icon={<CalendarDays size={14} />}
              title="Prospect history"
              subtitle={`${customer.lead_history.length} lead${
                customer.lead_history.length !==
                1
                  ? "s"
                  : ""
              }`}
            />

            {customer.lead_history.length ===
            0 ? (
              <EmptyState text="No prospect history." />
            ) : (
              <div className="divide-y divide-border">

                {customer.lead_history.map(
                  (lead) => (
                    <Link
                      key={lead.id}
                      href={`/crm/leads/${lead.id}`}
                      className="block p-4 transition hover:bg-surface-secondary/40"
                    >

                      <div className="flex items-start justify-between gap-3">

                        <div>

                          <div className="text-xs font-medium text-text">
                            {lead.name}
                          </div>

                          <div className="mt-1 text-[10px] text-muted">
                            {formatDate(
                              lead.created
                            )}
                          </div>

                        </div>

                        <CRMStageBadge
                          stage={
                            lead.stage
                          }
                        />

                      </div>

                      {lead.salesperson && (
                        <div className="mt-3 flex items-center gap-2 text-[10px] text-muted">
                          <UserRound
                            size={11}
                          />
                          {
                            lead.salesperson
                          }
                        </div>
                      )}

                      {lead.description && (
                        <p className="mt-3 text-[10px] leading-4 text-muted">
                          {
                            lead.description
                          }
                        </p>
                      )}

                    </Link>
                  )
                )}

              </div>
            )}

          </section>

        </div>

      </section>

      <DocumentsPanel key={customer.id} owner="customers" recordId={customer.id} />
    </main>
  );
}

// ============================================================
// SECTION HEADER
// ============================================================

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-4">

      <div className="flex items-center gap-2">

        <span className="text-lime-ink">
          {icon}
        </span>

        <div>

          <h2 className="font-[Syne] text-sm font-semibold">
            {title}
          </h2>

          <p className="mt-0.5 text-[10px] text-muted">
            {subtitle}
          </p>

        </div>

      </div>

    </div>
  );
}

// ============================================================
// INFO ITEM
// ============================================================

function InfoItem({
  label,
  value,
  badge = false,
}: {
  label: string;
  value: string;
  badge?: boolean;
}) {
  return (
    <div className="border-b border-border px-4 py-4">

      <div className="text-[9px] uppercase tracking-wider text-muted">
        {label}
      </div>

      <div className="mt-1.5 text-xs text-text-secondary">

        {badge ? (
          <CRMStageBadge stage={value} />
        ) : (
          value
        )}

      </div>

    </div>
  );
}

// ============================================================
// CONTACT ROW
// ============================================================

function ContactRow({
  icon,
  label,
  value,
  editing = false,
  draft = "",
  saving = false,
  onDraftChange,
  onEdit,
  onCancel,
  onSave,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  editing?: boolean;
  draft?: string;
  saving?: boolean;
  onDraftChange?: (value: string) => void;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
}) {
  const editable = Boolean(onEdit);

  return (
    <div className="flex gap-3 border-b border-border py-3 last:border-b-0">

      <div className="mt-0.5 text-muted">
        {icon}
      </div>

      <div className="min-w-0 flex-1">

        <div className="flex items-center justify-between gap-2">
          <div className="text-[9px] uppercase tracking-wider text-muted">
            {label}
          </div>
          {editable && !editing && (
            <button type="button" onClick={onEdit} className="text-[9px] text-lime-ink hover:underline">
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(event) => onDraftChange?.(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") onSave?.(); if (event.key === "Escape") onCancel?.(); }}
              className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-text outline-none focus:border-[#C8F065]"
            />
            <button type="button" disabled={saving} onClick={onSave} className="shrink-0 text-[10px] font-medium text-lime-ink disabled:opacity-50">
              {saving ? "…" : "Save"}
            </button>
            <button type="button" onClick={onCancel} className="shrink-0 text-[10px] text-muted">
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-1 break-words text-xs text-text-secondary">
            {value}
          </div>
        )}

      </div>

    </div>
  );
}

// ============================================================
// SUMMARY ROW
// ============================================================

function SummaryRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">

      <span className="text-[10px] text-muted">
        {label}
      </span>

      <span
        className={`text-xs font-medium ${
          highlight
            ? "text-pink-ink"
            : "text-text-secondary"
        }`}
      >
        {value}
      </span>

    </div>
  );
}

// ============================================================
// CRM STAGE BADGE
// ============================================================

function CRMStageBadge({
  stage,
}: {
  stage: string | null;
}) {
  if (!stage) {
    return (
      <span className="inline-flex rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-[9px] font-medium text-muted">
        No stage
      </span>
    );
  }

  const value = stage.toLowerCase();

  let className =
    "border-border bg-surface-secondary text-text-secondary";

  if (value.includes("contact")) {
    className =
      "border-blue-400/20 bg-blue-400/10 text-blue-400";
  } else if (
    value.includes("devis") ||
    value.includes("proposal")
  ) {
    className =
      "border-violet-400/20 bg-violet-400/10 text-violet-400";
  } else if (
    value.includes("réservation") ||
    value.includes("reservation")
  ) {
    className =
      "border-[#C8F065]/20 bg-[#C8F065]/10 text-lime-ink";
  } else if (
    value.includes("véhicule remis") ||
    value.includes("vehicule remis")
  ) {
    className =
      "border-[#F06AAA]/20 bg-[#F06AAA]/10 text-pink-ink";
  } else if (
    value.includes("location terminée") ||
    value.includes("location terminee")
  ) {
    className =
      "border-orange-400/20 bg-orange-400/10 text-orange-400";
  }

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-medium ${className}`}
    >
      {stage}
    </span>
  );
}

// ============================================================
// RENTAL STATUS
// ============================================================

function RentalStatusBadge({
  status,
}: {
  status: string | null;
}) {
  if (status === "Réservé") {
    return (
      <span className="inline-flex rounded-full border border-[#C8F065]/20 bg-[#C8F065]/10 px-2.5 py-1 text-[9px] font-medium text-lime-ink">
        Reserved
      </span>
    );
  }

  if (status === "Loué") {
    return (
      <span className="inline-flex rounded-full border border-[#F06AAA]/20 bg-[#F06AAA]/10 px-2.5 py-1 text-[9px] font-medium text-pink-ink">
        Rented
      </span>
    );
  }

  return null;
}

// ============================================================
// LARGE RENTAL STATUS
// ============================================================

function RentalStatusLarge({
  status,
}: {
  status: string;
}) {
  if (status === "Réservé") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[#C8F065]/20 bg-[#C8F065]/5 p-4">

        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#C8F065]/10">
          <CalendarDays
            size={16}
            className="text-lime-ink"
          />
        </div>

        <div>

          <div className="text-sm font-medium text-lime-ink">
            Reserved
          </div>

          <div className="mt-0.5 text-[10px] text-muted">
            Vehicle reservation confirmed
          </div>

        </div>

      </div>
    );
  }

  if (status === "Loué") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[#F06AAA]/20 bg-[#F06AAA]/5 p-4">

        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F06AAA]/10">
          <CheckCircle2
            size={16}
            className="text-pink-ink"
          />
        </div>

        <div>

          <div className="text-sm font-medium text-pink-ink">
            Rented
          </div>

          <div className="mt-0.5 text-[10px] text-muted">
            Vehicle has been handed over
          </div>

        </div>

      </div>
    );
  }

  return null;
}

// ============================================================
// PAYMENT BADGE
// ============================================================

function PaymentBadge({
  status,
}: {
  status: string;
}) {
  const value =
    status.toLowerCase();

  if (
    value === "paid" ||
    value === "in_payment"
  ) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[#C8F065]/20 bg-[#C8F065]/10 px-2 py-1 text-[8px] font-medium text-lime-ink">
        <CheckCircle2 size={9} />
        Paid
      </span>
    );
  }

  if (
    value === "not_paid" ||
    value === "partial"
  ) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[#F06AAA]/20 bg-[#F06AAA]/10 px-2 py-1 text-[8px] font-medium text-pink-ink">
        <XCircle size={9} />
        Unpaid
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-border bg-surface-secondary px-2 py-1 text-[8px] text-muted">
      {status}
    </span>
  );
}

// ============================================================
// ORDER STATUS
// ============================================================

function OrderStatusBadge({
  status,
}: {
  status: string | null;
}) {
  if (!status) {
    return null;
  }

  const labels: Record<string, string> = {
    draft: "Quotation",
    sent: "Sent",
    sale: "Sales order",
    done: "Locked",
    cancel: "Cancelled",
  };

  return (
    <span className="rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[8px] text-muted">
      {labels[status] || status}
    </span>
  );
}

// ============================================================
// EMPTY STATE
// ============================================================

function EmptyState({
  text,
}: {
  text: string;
}) {
  return (
    <div className="p-8 text-center text-xs text-muted">
      {text}
    </div>
  );
}

// ============================================================
// HELPERS
// ============================================================

function getInitials(name: string) {
  if (!name) {
    return "?";
  }

  const parts = name
    .trim()
    .split(/\s+/);

  if (parts.length === 1) {
    return parts[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function formatCurrency(
  value: number | null | undefined
) {
  const amount =
    typeof value === "number"
      ? value
      : 0;

  return `${amount.toLocaleString(
    "fr-TN"
  )} TND`;
}

function formatDate(
  value: string | null | undefined
) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(
    "fr-TN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  );
}

function formatAddress(
  address: Customer["address"]
) {
  const parts = [
    address.street,
    address.street2,
    address.zip,
    address.city,
    address.country,
  ].filter(Boolean);

  return parts.length > 0
    ? parts.join(", ")
    : "No address";
}
