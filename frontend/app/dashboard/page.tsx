"use client";

import { useFeatures } from "@/components/providers/FeaturesProvider";
import { RentalFleetNotice } from "@/components/fleet/FleetCare";

import { useKlynxUI } from "@/components/providers/UIProvider";

import ActivitiesPanel from "@/components/activities/ActivitiesPanel";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Car,
  Clock3,
  Plus,
  Users,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card, CardHeader } from "@/components/ui/Card";
import CreateRentalModal from "@/components/rentals/CreateRentalModal";
import { RentalActionMenu } from "@/components/rentals/RentalActionMenu";
import ReturnVehicleModal from "@/components/rentals/ReturnVehicleModal";

import { formatCurrency, formatDateShort, isSameDay, parseDate } from "@/lib/format";
import { getFleetStatus, getRentalState, rentalStateMeta, type RentalState } from "@/lib/status";
import { API_URL, apiRequest } from "@/lib/api-config";

// ============================================================
// TYPES
// (kept local — these mirror raw Odoo fields returned by /cars,
// /customers, /sales, /invoices, distinct from the shapes in
// lib/api.ts used by other flows)
// ============================================================

type RelationalValue =
  | string
  | number
  | { id?: number; name?: string }
  | null
  | false
  | undefined;

type CarData = {
  id: number;
  name: string;
  license_plate: string | null;
  model: string | null;
  category?: string | null;
  status: RelationalValue;
  active?: boolean;
};

type CustomerData = {
  id: number;
  name: string;
};

type SaleData = {
  id: number;
  name: string;
  customer: RelationalValue;
  state: string;
  date_order: string | null;
  commitment_date: string | null;
  amount_total: number;
  vehicle_id?: number | null;
  returned?: boolean;
  picked_up?: boolean;
  booking_status?: string;
  paperwork?: {documents_ready: boolean; contract_ready: boolean};
};

type InvoiceData = {
  id: number;
  state: string;
  payment_state: string;
  amount_residual: number;
};

// Recent-rentals ordering: quotations first (need action), then
// confirmed/ongoing (in progress), then completed/cancelled last —
// matches the priority the dashboard is meant to surface.
const STATUS_PRIORITY: Record<RentalState, number> = {
  pickup_due: 0,
  return_due: 0,
  draft: 0,
  confirmed: 1,
  ongoing: 1,
  completed: 2,
  cancelled: 3,
};

function displayValue(value: RelationalValue): string {
  if (value === null || value === undefined || value === false) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return value.name || "";
}

// ============================================================
// COMPONENT
// ============================================================

export default function DashboardPage() {
  const features = useFeatures();
  const { t } = useKlynxUI();
  const router = useRouter();
  const [cars, setCars] = useState<CarData[]>([]);
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [sales, setSales] = useState<SaleData[]>([]);
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);

  const [loading, setLoading] = useState(true);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [returningVehicle, setReturningVehicle] = useState<{
    id: number; orderId: number; nextState: "Nettoyage" | "Disponible";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Neutral on the server (and on the client's very first render,
  // before this effect runs) so SSR output and the initial client
  // render always match exactly. Filled in right after mount —
  // computing this directly during render was the actual bug:
  // the server renders in its own timezone while the browser
  // hydrates in the agent's local one, so near an hour boundary
  // they'd disagree on "Good morning" vs "Good evening" and React
  // would flag a hydration mismatch.
  const [greetingText, setGreetingText] = useState("Welcome back.");

  useEffect(() => {
    const hour = new Date().getHours();

    if (hour < 12) setGreetingText("Good morning.");
    else if (hour < 18) setGreetingText("Good afternoon.");
    else setGreetingText("Good evening.");
  }, []);

  async function loadDashboard() {
    try {
      setLoading(true);
      setError(null);

      try {
        await apiRequest(`${API_URL}/cars/sync`, { method: "POST" });
      } catch (syncError) {
        console.error("Fleet state sync failed:", syncError);
      }

      const [carsRes, customersRes, salesRes, invoicesRes] = await Promise.all([
        apiRequest(`${API_URL}/cars`, { cache: "no-store" }),
        apiRequest(`${API_URL}/customers`, { cache: "no-store" }),
        apiRequest(`${API_URL}/sales?for_fleet=true&with_paperwork=true`, { cache: "no-store" }),
        apiRequest(`${API_URL}/invoices`, { cache: "no-store" }),
      ]);

      if (!carsRes.ok) throw new Error(`Cars API returned ${carsRes.status}`);
      if (!customersRes.ok) throw new Error(`Customers API returned ${customersRes.status}`);
      if (!salesRes.ok) throw new Error(`Sales API returned ${salesRes.status}`);
      if (!invoicesRes.ok) throw new Error(`Invoices API returned ${invoicesRes.status}`);

      const carsData = await carsRes.json();
      const customersData = await customersRes.json();
      const salesData = await salesRes.json();
      const invoicesData = await invoicesRes.json();

      setCars(Array.isArray(carsData.cars) ? carsData.cars : []);
      setCustomers(Array.isArray(customersData.customers) ? customersData.customers : []);
      setSales(Array.isArray(salesData.sales) ? salesData.sales : []);
      setInvoices(Array.isArray(invoicesData.invoices) ? invoicesData.invoices : []);
    } catch (err) {
      console.error("Dashboard API error:", err);
      setError(err instanceof Error ? err.message : "Unable to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  // Shared by every dashboard action row: run a rental mutation,
  // reload once, surface an error if it fails. One implementation
  // instead of a bespoke try/catch per action.
  async function runAction(path: string, method: string, notFetchLabel: string, body?: unknown) {
    try {
      const response = await apiRequest(`${API_URL}${path}`, {
        method,
        ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || `API returned ${response.status}`);
      }
      await loadDashboard();
    } catch (err) {
      console.error(`${notFetchLabel} failed:`, err);
      setError(err instanceof Error ? err.message : `Unable to ${notFetchLabel.toLowerCase()}.`);
    }
  }

  function handleReturn(vehicleId: number, nextState: "Nettoyage" | "Disponible", saleId: number) {
    setReturningVehicle({ id: vehicleId, orderId: saleId, nextState });
  }

  function handlePickedUp(saleId: number) {
    void runAction(`/rentals/${saleId}/picked-up`, "POST", "confirm pickup");
  }

  function handleCancel(saleId: number) {
    void runAction(`/rentals/${saleId}/cancel`, "POST", "cancel booking");
  }

  // --------------------------------------------------------
  // DERIVED DATA
  // --------------------------------------------------------

  const carsById = useMemo(() => {
    const map = new Map<number, CarData>();
    cars.forEach((car) => map.set(car.id, car));
    return map;
  }, [cars]);

  const availableCars = useMemo(
    () =>
      cars.filter(
        (car) =>
          getFleetStatus({ status: displayValue(car.status), active: car.active }) ===
          "available"
      ).length,
    [cars]
  );

  const activeSales = useMemo(
    () => sales.filter((sale) => sale.state !== "cancel" && sale.booking_status !== "cancelled" && !sale.returned && (sale.booking_status === "confirmed" || (sale.booking_status !== "quotation" && ["sale", "done"].includes(sale.state)))),
    [sales]
  );

  const unpaidInvoices = invoices.filter(
    (invoice) => invoice.payment_state !== "paid" && invoice.state === "posted"
  );

  const outstandingAmount = unpaidInvoices.reduce(
    (sum, invoice) => sum + (Number(invoice.amount_residual) || 0),
    0
  );

  const today = new Date();

  // Pickups due today: rental starts today, not yet picked up or completed/cancelled.
  const pickupsToday = useMemo(() => {
    return activeSales.filter((sale) => {
      const date = parseDate(sale.date_order);
      return date && isSameDay(date, today) && !sale.picked_up;
    });
  }, [activeSales]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returns due today: commitment date is today, order still open.
  const returnsToday = useMemo(() => {
    return activeSales.filter((sale) => {
      const date = parseDate(sale.commitment_date);
      return (
        date &&
        isSameDay(date, today) &&
        sale.picked_up &&
        !sale.returned
      );
    });
  }, [activeSales]); // eslint-disable-line react-hooks/exhaustive-deps

  // Overdue: commitment date has passed and order is still open — this
  // is what actually needs a sales agent's attention, not a generic feed.
  const overdue = useMemo(() => {
    return activeSales.filter((sale) => {
      const date = parseDate(sale.commitment_date);
      return (
        date &&
        date < today &&
        !isSameDay(date, today) &&
        sale.picked_up &&
        !sale.returned
      );
    });
  }, [activeSales]); // eslint-disable-line react-hooks/exhaustive-deps

  const latePickups = activeSales.filter(sale => getRentalState(sale) === "pickup_due");
  const missingPaperwork = pickupsToday.filter(sale => !sale.paperwork?.contract_ready);
  const attentionCount = overdue.length + latePickups.length + missingPaperwork.length;

  // Recent rentals: quotations first, then confirmed/ongoing, then
  // completed/cancelled last — the full list (cancelled included),
  // not just activeSales, since cancelled bookings still need to
  // show up (at the back of the queue) for the count to be honest.
  const recentRentals = useMemo(() => {
    return [...sales]
      .sort((a, b) => {
        const priorityDiff = STATUS_PRIORITY[getRentalState(a)] - STATUS_PRIORITY[getRentalState(b)];
        if (priorityDiff !== 0) return priorityDiff;
        return (b.date_order || "").localeCompare(a.date_order || "");
      })
      .slice(0, 5);
  }, [sales]);

  function vehicleLabel(sale: SaleData): string {
    if (!sale.vehicle_id) return "No vehicle assigned";
    const car = carsById.get(sale.vehicle_id);
    return car ? car.name : `Vehicle #${sale.vehicle_id}`;
  }

  return (
    <main className="mx-auto max-w-[1400px] p-5 sm:p-8">
      <PageHeader
        breadcrumb="Overview"
        title={greetingText}
        subtitle="Here's what's happening with your rental operation."
        action={
          <button
            type="button"
            onClick={() => setBookingOpen(true)}
            className="flex h-11 items-center gap-2 rounded-xl bg-lime px-5 text-sm font-semibold text-[#111113] shadow-glow-lime transition hover:bg-lime-dark"
          >
            <Plus size={16} />
            New rental
          </button>
        }
      />

      <CreateRentalModal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        onCreated={() => {
          setBookingOpen(false);
          loadDashboard();
        }}
      />

      {error && (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-xs text-danger">
          {error}
        </div>
      )}

      {/* QUICK METRICS — glance-only, each links to where the action happens */}
      <section aria-label="Overview metrics" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Link href="/dashboard/fleet" className="rounded-xl"><StatCard icon={<Car size={15} />} label="Available vehicles" value={availableCars.toString()} detail={`of ${cars.length} in fleet`} loading={loading} /></Link>
        <a href="#attention" className="rounded-xl"><StatCard icon={<span className={attentionCount ? "klynx-attention-flicker inline-flex" : "inline-flex"}><AlertTriangle size={15} /></span>} label="Needs attention" value={attentionCount.toString()} detail="pickup paperwork / late pickups / overdue returns" tone={attentionCount ? "danger" : undefined} loading={loading} /></a>
        <Link href="/dashboard/customers" className="rounded-xl"><StatCard icon={<Users size={15} />} label="Customers" value={customers.length.toString()} detail="customer records" tone="pink" loading={loading} /></Link>
        <Link href="/dashboard/rentals" className="rounded-xl"><StatCard icon={<ArrowUpRight size={15} />} label="Outstanding" value={formatCurrency(outstandingAmount)} detail="posted invoices to collect" tone="danger" loading={loading} /></Link>
      </section>

      {/* 1. VEHICLE ATTENTION — overdue returns need a decision before anything else */}
      {!loading && attentionCount > 0 && (
        <section id="attention" className="mt-4 scroll-mt-5">
          <Card className="border-danger/30">
            <CardHeader
              title="Needs attention"
              subtitle={t(`${missingPaperwork.length} pickup paperwork incomplete · ${latePickups.length} late pickup${latePickups.length === 1 ? "" : "s"} · ${overdue.length} overdue return${overdue.length === 1 ? "" : "s"}`)}
            />
            <div className="p-4">
              <div className="space-y-1">
                {missingPaperwork.map(sale => <ScheduleRow key={`paperwork-${sale.id}`} sale={sale} vehicleLabel={vehicleLabel(sale)} icon={<AlertTriangle size={14} />} urgent kind="pickup" onPickedUp={handlePickedUp} onCancel={handleCancel} />)}
                {latePickups.map(sale => <ScheduleRow key={sale.id} sale={sale} vehicleLabel={vehicleLabel(sale)}
                  icon={<AlertTriangle size={14} />} urgent kind="pickup" onPickedUp={handlePickedUp} onCancel={handleCancel} />)}
                {overdue.map((sale) => (
                  <ScheduleRow
                    key={sale.id}
                    sale={sale}
                    vehicleLabel={vehicleLabel(sale)}
                    icon={<AlertTriangle size={14} />}
                    urgent
                    kind="overdue"
                    onReturn={handleReturn}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* 2. PICKUPS + RETURNS TODAY — the day's must-do actions */}
      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Pickups today" subtitle="Rentals starting today" />
          <div className="p-4">
            {loading ? <LoadingRows /> : pickupsToday.length === 0 ? (
              <EmptyState icon={<Clock3 />} title="No pickups today" description="Nothing scheduled to go out today." />
            ) : (
              <div className="space-y-1">
                {pickupsToday.map((sale) => (
                  <ScheduleRow key={sale.id} sale={sale} vehicleLabel={vehicleLabel(sale)} icon={<ArrowUpRight size={14} />} kind="pickup" onPickedUp={handlePickedUp} onCancel={handleCancel} />
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Returns today" subtitle="Rentals due back today" />
          <div className="p-4">
            {loading ? <LoadingRows /> : returnsToday.length === 0 ? (
              <EmptyState icon={<Clock3 />} title="No returns today" description="Nothing due back today." />
            ) : (
              <div className="space-y-1">
                {returnsToday.map((sale) => (
                  <ScheduleRow key={sale.id} sale={sale} vehicleLabel={vehicleLabel(sale)} icon={<ArrowDownLeft size={14} />} kind="return" onReturn={handleReturn} />
                ))}
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* 3. TO-DO / REMINDERS — due & overdue activities */}
      {features?.automatic_reminders && <div className="mt-4"><ActivitiesPanel compact /></div>}

      {/* 4. RECENT RENTALS — last: quick history, not the day's priority */}
      <section className="mt-4"><Card>
        <CardHeader title="Recent rentals" subtitle="Quotations first, then in progress, then closed" action={<Link href="/dashboard/rentals" className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary transition hover:text-lime-ink">View all →</Link>} />
        <div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm"><thead className="border-b border-border text-[10px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-3 font-normal">Customer</th><th className="px-4 py-3 font-normal">Vehicle</th><th className="px-4 py-3 font-normal">Pickup</th><th className="px-4 py-3 font-normal">Return</th><th className="px-5 py-3 font-normal">Status</th></tr></thead><tbody className="divide-y divide-border">
          {loading ? <tr><td colSpan={5} className="p-5 text-muted">Loading rentals…</td></tr> : !recentRentals.length ? <tr><td colSpan={5} className="p-5 text-muted">No rentals yet. Create your first booking above.</td></tr> : recentRentals.map(sale => (
            <tr key={sale.id} onClick={() => router.push(`/dashboard/rentals/${sale.id}`)} className="cursor-pointer hover:bg-white/[0.02]">
              <td className="max-w-64 truncate px-5 py-4 font-medium">{displayValue(sale.customer) || sale.name}</td>
              <td className="max-w-64 truncate px-4 py-4 text-text-secondary">{sale.vehicle_id ? <Link href={`/dashboard/calendar?vehicle=${sale.vehicle_id}`} onClick={(event) => event.stopPropagation()} className="hover:text-lime-ink">{vehicleLabel(sale)}</Link> : "Not assigned"}</td>
              <td className="whitespace-nowrap px-4 py-4 text-xs text-text-secondary">{formatDateShort(sale.date_order)}</td>
              <td className="whitespace-nowrap px-4 py-4 text-xs text-text-secondary">{formatDateShort(sale.commitment_date)}</td>
              <td className="px-5 py-4"><StatusBadge meta={rentalStateMeta(getRentalState(sale))} withDot={false} className="normal-case tracking-normal" /></td>
            </tr>
          ))}
        </tbody></table></div>
      </Card></section>
      <RentalFleetNotice />
      {returningVehicle && <ReturnVehicleModal vehicleId={returningVehicle.id} orderId={returningVehicle.orderId}
        initialNextState={returningVehicle.nextState} onClose={() => setReturningVehicle(null)}
        onReturned={async () => { await loadDashboard(); setReturningVehicle(null); }} />}
    </main>
  );
}

// ============================================================
// SUBCOMPONENTS
// ============================================================

function ScheduleRow({
  sale,
  vehicleLabel,
  icon,
  urgent = false,
  kind,
  onReturn,
  onPickedUp,
  onCancel,
}: {
  sale: SaleData;
  vehicleLabel: string;
  icon: React.ReactNode;
  urgent?: boolean;
  kind: "pickup" | "return" | "overdue";
  onReturn?: (vehicleId: number, nextState: "Nettoyage" | "Disponible", saleId: number) => void;
  onPickedUp?: (saleId: number) => void;
  onCancel?: (saleId: number) => void;
}) {
  const customerName = displayValue(sale.customer) || "Unknown customer";
  const rentalMeta = rentalStateMeta(getRentalState(sale));
  const dateLabel = urgent
    ? `${kind === "pickup" ? "Pickup due" : "Return due"} ${formatDateShort(kind === "pickup" ? sale.date_order : sale.commitment_date)}`
    : sale.name;

  // Clicking the row opens the action menu, not the rental page directly —
  // "View rental" inside the menu is what navigates through.
  return (
    <div className={`flex items-center gap-3 rounded-lg px-2 py-2.5 transition ${urgent ? "hover:bg-danger/10" : "hover:bg-surface-secondary/50"}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${urgent ? "bg-danger/10 text-danger" : "bg-lime/10 text-lime-ink"}`}>
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-text">{customerName}</div>
        <div className="mt-0.5 truncate text-[10px] text-muted">{vehicleLabel} · {dateLabel}</div>
        {kind === "pickup" && !sale.paperwork?.contract_ready && <Link href={`/dashboard/rentals/${sale.id}#paperwork`} className="text-xs text-danger underline">{sale.paperwork?.documents_ready ? "Contract not ready" : "Identity / licence to verify"} →</Link>}
      </div>

      <StatusBadge meta={rentalMeta} withDot={false} />

      <RentalActionMenu sale={sale} kind={kind} onReturn={onReturn} onPickedUp={onPickedUp} onCancel={onCancel} />
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-12 animate-pulse rounded-lg bg-surface-secondary" />
      ))}
    </div>
  );
}
