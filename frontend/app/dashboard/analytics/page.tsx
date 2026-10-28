"use client";

import { useKlynxUI } from "@/components/providers/UIProvider";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {

  BarChart3,
  CalendarDays,
  ChevronDown,
  List,
  RefreshCw,
  Table2,
  TrendingUp,
  
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/format";
import { API_URL, apiRequest } from "@/lib/api-config";

type Analytics = {
  range: {
    start: string;
    end: string;
  };

  summary: {
    revenue: number;
    orders: number;
    average_order: number;
    invoiced: number;
    collected: number;
    outstanding: number;
  };

  fleet: {
    total_vehicles: number;
    rented: number;
    available: number;
    utilization_rate: number;
  };

  comparison: {
    revenue_change: number | null;
    orders_change: number | null;
  };

  monthly: {
    key: string;
    label: string;
    revenue: number;
    orders: number;
    invoiced: number;
    collected: number;
  }[];

  product_categories: {
    name: string;
    revenue: number;
    orders: number;
    share: number;
  }[];

  fleet_categories: {
    name: string;
    revenue: number;
    orders: number;
    share: number;
  }[];

  customers: {
    name: string;
    revenue: number;
    orders: number;
  }[];

  vehicles: {
    id: number;
    name: string;
    license_plate: string;
    revenue: number;
    orders: number;
    share: number;
  }[];
  vehicle_options: { id: number; name: string; license_plate: string }[];

  orders: {
    id: number;
    name: string;
    customer: string;
    date: string | null;
    amount: number;
    state: string;
    vehicle: string | null;
    vehicle_id: number | null;
    fleet_category: string;
  }[];
};

type ViewMode =
  | "graph"
  | "pivot"
  | "orders";

type GroupMode =
  | "month"
  | "product"
  | "fleet"
  | "vehicle"
  | "customer";

const groupLabels: Record<GroupMode, string> = {
  month: "Month", product: "Product category", fleet: "Vehicle category",
  vehicle: "Vehicle", customer: "Customer",
};

function vehicleLabel(vehicle: { id: number; name: string; license_plate: string }) {
  return `${vehicle.name} · ${vehicle.license_plate || `#${vehicle.id}`}`;
}

type Measure =
  | "revenue"
  | "orders"
  | "average";

function getYearRange(year: number) {
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function SectionEmpty({
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

function BreakdownList({
  items,
}: {
  items: {
    name: string;
    revenue: number;
    orders: number;
    share: number;
  }[];
}) {
  if (!items.length) {
    return (
      <SectionEmpty text="No data for this period." />
    );
  }

  const max = Math.max(
    ...items.map((item) => item.revenue),
    1
  );

  return (
    <div className="divide-y divide-border">
      {items.map((item) => {
        const width =
          (item.revenue / max) * 100;

        return (
          <div
            key={item.name}
            className="px-5 py-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text">
                  {item.name}
                </div>

                <div className="mt-1 text-[10px] text-muted">
                  {item.orders}{" "}
                  {item.orders === 1
                    ? "order"
                    : "orders"}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold text-text">
                  {formatCurrency(
                    item.revenue
                  )}
                </div>

                <div className="mt-1 text-[10px] text-muted">
                  {item.share}%
                </div>
              </div>
            </div>

            <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-lime"
                style={{
                  width: `${width}%`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AnalyticsPage() {
  const { t } = useKlynxUI();
  const currentYear =
    new Date().getFullYear();

  const [year, setYearState] =
    useState(currentYear);

  const [vehicleId, setVehicleIdState] = useState("");
  const requestVersion = useRef(0);
  const [data, setData] =
    useState<Analytics | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [view, setView] =
    useState<ViewMode>("graph");

  const [groupBy, setGroupBy] =
    useState<GroupMode>("month");

  const [measure, setMeasure] =
    useState<Measure>("revenue");

  const [periodOpen, setPeriodOpen] =
    useState(false);

  const [groupOpen, setGroupOpen] =
    useState(false);

  function setYear(value: number) {
    if (value === year) return;
    setLoading(true);
    setError("");
    setYearState(value);
  }

  function setVehicleId(value: string) {
    if (value === vehicleId) return;
    setLoading(true);
    setError("");
    setVehicleIdState(value);
  }

  const loadAnalytics = useCallback(() => {
    const version = ++requestVersion.current;
    const range = getYearRange(year);
    return apiRequest(`${API_URL}/analytics?start_date=${range.start}&end_date=${range.end}${vehicleId ? `&vehicle_id=${vehicleId}` : ""}`, { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return response.json() as Promise<Analytics>;
      }).then(result => {
      if (version === requestVersion.current) {
        setData(result);
        setError("");
      }
      }).catch(error => {
        console.error("Analytics loading failed:", error);
        if (version === requestVersion.current) setError("Unable to load analytics.");
      }).finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });
  }, [year, vehicleId]);

  useEffect(() => {
    loadAnalytics();
    return () => { requestVersion.current += 1; };
  }, [loadAnalytics]);

  const pivotRows = useMemo(() => {
    if (!data) return [];

    const items = groupBy === "month"
      ? data.monthly.map(item => ({ ...item, id: item.key, name: item.label }))
      : groupBy === "vehicle"
        ? data.vehicles.map(item => ({ ...item, name: vehicleLabel(item) }))
        : groupBy === "product" ? data.product_categories
          : groupBy === "fleet" ? data.fleet_categories : data.customers;
    const rows = items.map(item => ({
      key: "id" in item ? String(item.id) : item.name,
      label: item.name, revenue: item.revenue, orders: item.orders,
      average: item.orders ? item.revenue / item.orders : 0,
    }));
    return groupBy === "month" ? rows : rows.sort((a, b) => b[measure] - a[measure]);
  }, [data, groupBy, measure]);

  const measureValue = (
    row: {
      revenue: number;
      orders: number;
      average: number;
    }
  ) => {
    if (measure === "orders") {
      return row.orders;
    }

    if (measure === "average") {
      return row.average;
    }

    return row.revenue;
  };

  const measureLabel =
    measure === "orders"
      ? "Orders"
      : measure === "average"
        ? "Average order"
        : "Revenue";
  const chartMax = Math.max(...pivotRows.map(measureValue), 1);

  return (
    <main className="mx-auto max-w-[1500px] p-5 sm:p-8">
      <PageHeader
        breadcrumb="Analytics"
        title="Analytics"
        subtitle="Understand revenue, rentals and fleet performance."
        action={
          <button
            type="button"
            onClick={() => { setLoading(true); setError(""); void loadAnalytics(); }}
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text transition hover:bg-surface-2"
          >
            <RefreshCw
              size={13}
              className={
                loading
                  ? "animate-spin"
                  : ""
              }
            />
            Refresh
          </button>
        }
      />

      {/* ======================================================
          FLEET UTILIZATION — live snapshot, not tied to the
          selected year. The single most important operational
          number for a rental agency, shown first.
      ====================================================== */}

      {data && (
        <section className="mt-7">
          <div className="overflow-hidden rounded-xl border border-lime/20 bg-gradient-to-br from-lime/[0.06] to-transparent p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
                  Live · right now
                </div>

                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-syne text-[34px] font-semibold text-text">
                    {data.fleet.utilization_rate}%
                  </span>
                  <span className="text-xs text-muted">
                    fleet utilization
                  </span>
                </div>

                <p className="mt-1 text-xs text-muted">
                  {data.fleet.rented} rented ·{" "}
                  {data.fleet.available} available ·{" "}
                  {data.fleet.total_vehicles} active vehicles
                </p>
              </div>

              <div className="w-full sm:w-[280px]">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-lime transition-all"
                    style={{
                      width: `${data.fleet.utilization_rate}%`,
                    }}
                  />
                </div>

                <div className="mt-2 flex justify-between text-[10px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                    Rented
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-surface-2 ring-1 ring-border" />
                    Available
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ======================================================
          ANALYSIS CONTROLS
      ====================================================== */}

      <section className="mt-7 rounded-xl border border-border bg-surface/80">
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setYear(
                  Math.max(
                    2020,
                    year - 1
                  )
                )
              }
              className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-xs text-muted transition hover:text-text"
            >
              ←
            </button>

            <button
              type="button"
              onClick={() =>
                setYear(
                  Math.min(
                    2100,
                    year + 1
                  )
                )
              }
              className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-xs text-muted transition hover:text-text"
            >
              →
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setPeriodOpen(
                    !periodOpen
                  )
                }
                className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-xs font-medium text-text"
              >
                <CalendarDays
                  size={13}
                />
                {year}
                <ChevronDown
                  size={12}
                />
              </button>

              {periodOpen && (
                <div className="absolute left-0 top-11 z-30 w-32 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  {[currentYear, currentYear - 1, currentYear - 2]
                    .filter(
                      (item) =>
                        item >= 2020
                    )
                    .map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          setYear(item);
                          setPeriodOpen(
                            false
                          );
                        }}
                        className={`block w-full px-3 py-2 text-left text-xs ${
                          item === year
                            ? "bg-lime/10 text-lime-ink"
                            : "text-muted hover:bg-surface-2 hover:text-text"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <span className="text-[11px] text-muted">
              Jan 1 — Dec 31
            </span>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-1">
            <button
              type="button"
              onClick={() =>
                setView("graph")
              }
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs ${
                view === "graph"
                  ? "bg-surface text-text shadow-sm"
                  : "text-muted"
              }`}
            >
              <BarChart3 size={13} />
              Graph
            </button>

            <button
              type="button"
              onClick={() =>
                setView("pivot")
              }
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs ${
                view === "pivot"
                  ? "bg-surface text-text shadow-sm"
                  : "text-muted"
              }`}
            >
              <Table2 size={13} />
              Pivot
            </button>

            <button
              type="button"
              onClick={() =>
                setView("orders")
              }
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs ${
                view === "orders"
                  ? "bg-surface text-text shadow-sm"
                  : "text-muted"
              }`}
            >
              <List size={13} />
              Orders
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-border px-4 py-3 sm:flex-row sm:items-center">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted">
            Measures
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              ["revenue", "Revenue"],
              ["orders", "Orders"],
              ["average", "Average order"],
            ].map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setMeasure(
                      value as Measure
                    )
                  }
                  className={`rounded-md border px-3 py-1.5 text-[10px] ${
                    measure === value
                      ? "border-lime/30 bg-lime/10 text-lime-ink"
                      : "border-border bg-surface-2 text-muted hover:text-text"
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
              Group by
            </span>

            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setGroupOpen(
                    !groupOpen
                  )
                }
                className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[10px] text-text"
              >
                {groupLabels[groupBy]}
                <ChevronDown
                  size={11}
                />
              </button>

              {groupOpen && (
                <div className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  {[
                    ["month", "Month"],
                    [
                      "product",
                      "Product category",
                    ],
                    [
                      "fleet",
                      "Vehicle category",
                    ],
                    ["vehicle", "Vehicle"],
                    [
                      "customer",
                      "Customer",
                    ],
                  ].map(
                    ([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setGroupBy(
                            value as GroupMode
                          );
                          setGroupOpen(
                            false
                          );
                        }}
                        className={`block w-full px-3 py-2 text-left text-[10px] ${
                          groupBy === value
                            ? "bg-lime/10 text-lime-ink"
                            : "text-muted hover:bg-surface-2 hover:text-text"
                        }`}
                      >
                        {label}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
          <label htmlFor="analytics-vehicle" className="text-xs font-medium text-text">Specific vehicle</label>
          <select id="analytics-vehicle" value={vehicleId} onChange={event => setVehicleId(event.target.value)}
            className="analytics-vehicle-select h-10 max-w-full rounded-lg border border-border bg-surface-secondary px-3 text-sm text-text">
            <option value="">All vehicles</option>
            {vehicleId && !data?.vehicle_options.some(vehicle => String(vehicle.id) === vehicleId) && (
              <option value={vehicleId}>Vehicle #{vehicleId} · no orders this period</option>
            )}
            {data?.vehicle_options.map(vehicle => (
              <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>
            ))}
          </select>
          <span className="text-xs text-muted">
            {vehicleId ? "Selected vehicle: confirmed sales and their linked invoices." : "Categories and vehicles load automatically. Choose Orders to compare demand."}
          </span>
        </div>
      </section>

      {error && (
        <div className="mt-4 rounded-lg border border-pink/20 bg-pink/5 px-4 py-3 text-xs text-pink-ink">
          {error}
        </div>
      )}

      {/* ======================================================
          KPI STRIP
      ====================================================== */}

      <section className="mobile-metrics mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          icon={<TrendingUp size={15} />}
          label="Revenue"
          value={
            data
              ? formatCurrency(
                  data.summary.revenue
                )
              : "—"
          }
          detail={`${year}`}
          loading={loading}
        />

        <StatCard
          icon={<BarChart3 size={15} />}
          label="Orders"
          value={
            data
              ? data.summary.orders.toString()
              : "—"
          }
          detail="confirmed"
          tone="pink"
          loading={loading}
        />

        <StatCard
          icon={<TrendingUp size={15} />}
          label="Average order"
          value={
            data
              ? formatCurrency(
                  data.summary.average_order
                )
              : "—"
          }
          detail="per order"
          loading={loading}
        />

        <StatCard
          icon={<TrendingUp size={15} />}
          label="Collected"
          value={
            data
              ? formatCurrency(
                  data.summary.collected
                )
              : "—"
          }
          detail="including security deposits"
          loading={loading}
        />

        <StatCard
          icon={<TrendingUp size={15} />}
          label="Outstanding"
          value={
            data
              ? formatCurrency(
                  data.summary.outstanding
                )
              : "—"
          }
          detail="including security deposits"
          tone="pink"
          loading={loading}
        />
      </section>

      <p className="mt-3 text-xs text-muted">Refundable security deposits are excluded from revenue. Billing and payment totals include deposits.</p>

      {/* ======================================================
          GRAPH
      ====================================================== */}

      {view === "graph" && data && (
        <>
          <section className="mt-4">
            <Card>
              <CardHeader
                title={measureLabel}
                subtitle={t(`${groupLabels[groupBy]} performance · ${year}`)}
              />

              <div className="p-5">
                <div className="flex min-h-[300px] items-end gap-2 overflow-x-auto sm:gap-3">
                  {pivotRows.map(
                    (row) => {
                      const value = measureValue(row);

                      const height = value / chartMax;

                      const tooltipValue =
                        measure === "orders"
                          ? `${value} orders`
                          : formatCurrency(value);

                      return (
                        <div
                          key={row.key}
                          className="group flex min-w-16 flex-1 flex-col justify-end"
                        >
                          <div className="relative flex h-[250px] items-end justify-center">
                            <div
                              className="w-full max-w-[42px] rounded-t-md bg-lime/70 transition hover:bg-lime"
                              style={{
                                height: `${Math.max(
                                  height * 250,
                                  value ? 4 : 0
                                )}px`,
                              }}
                              title={`${row.label}: ${tooltipValue}`}
                            />
                          </div>

                          <div className="mt-3 min-h-10 max-w-40 break-words text-center text-xs text-muted" title={row.label}>
                            {row.label}
                          </div>
                        </div>
                      );
                    }
                  )}
                  {!pivotRows.length && <SectionEmpty text="No data for this selection." />}
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                  <span className="text-[10px] text-muted">
                    Total revenue
                  </span>

                  <span className="font-syne text-sm font-semibold text-text">
                    {formatCurrency(
                      data.summary.revenue
                    )}
                  </span>
                </div>
              </div>
            </Card>
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Revenue by product category"
                subtitle="What the business sold"
              />

              <BreakdownList
                items={
                  data.product_categories
                }
              />
            </Card>

            <Card>
              <CardHeader
                title="Revenue by fleet category"
                subtitle="Which type of vehicle generated revenue"
              />

              <BreakdownList
                items={
                  data.fleet_categories
                }
              />
            </Card>
          </section>

          <section className="mt-4">
            <Card>
              <CardHeader title="Vehicle demand" subtitle="Ranked by confirmed sales; select a vehicle to inspect its performance." />
              {!data.vehicles.length ? <SectionEmpty text="No assigned vehicles for this period." /> : (
                <div className="divide-y divide-border">
                  {data.vehicles.map((vehicle, index) => (
                    <button key={vehicle.id} type="button" onClick={() => { setVehicleId(String(vehicle.id)); setGroupBy("vehicle"); setMeasure("orders"); }}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-surface-2">
                      <span className="min-w-0 break-words text-sm text-text"><span className="mr-3 text-lime-ink">#{index + 1}</span>{vehicleLabel(vehicle)}</span>
                      <span className="shrink-0 text-right text-sm text-text">{vehicle.orders} orders <span className="block text-xs text-muted">{formatCurrency(vehicle.revenue)}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </section>

          <section className="mt-4">
            <Card>
              <CardHeader
                title="Monthly breakdown"
                subtitle="Revenue and rental volume"
              />

              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left">
                  <thead>
                    <tr className="border-b border-border text-[9px] uppercase tracking-[0.12em] text-muted">
                      <th className="px-5 py-3">
                        Month
                      </th>
                      <th className="px-5 py-3 text-right">
                        Revenue
                      </th>
                      <th className="px-5 py-3 text-right">
                        Orders
                      </th>
                      <th className="px-5 py-3 text-right">
                        Average
                      </th>
                      <th className="px-5 py-3 text-right">
                        Collected
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-border">
                    {data.monthly.map(
                      (month) => (
                        <tr
                          key={month.key}
                          className="hover:bg-surface-2/60"
                        >
                          <td className="px-5 py-3 text-xs font-medium text-text">
                            {month.label}
                          </td>

                          <td className="px-5 py-3 text-right text-xs text-text">
                            {formatCurrency(
                              month.revenue
                            )}
                          </td>

                          <td className="px-5 py-3 text-right text-xs text-muted">
                            {month.orders}
                          </td>

                          <td className="px-5 py-3 text-right text-xs text-muted">
                            {formatCurrency(
                              month.orders
                                ? month.revenue /
                                    month.orders
                                : 0
                            )}
                          </td>

                          <td className="px-5 py-3 text-right text-xs text-muted">
                            {formatCurrency(
                              month.collected
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        </>
      )}

      {/* ======================================================
          PIVOT
      ====================================================== */}

      {view === "pivot" && data && (
        <section className="mt-4">
          <Card>
            <CardHeader
              title={`${t(measureLabel)} ${t("by")} ${t(groupLabels[groupBy])}`}
              subtitle="Analytical pivot"
            />

            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left">
                <thead>
                  <tr className="border-b border-border text-[9px] uppercase tracking-[0.12em] text-muted">
                    <th className="px-5 py-3">
                      {groupLabels[groupBy]}
                    </th>

                    <th className="px-5 py-3 text-right">
                      Revenue
                    </th>

                    <th className="px-5 py-3 text-right">
                      Orders
                    </th>

                    <th className="px-5 py-3 text-right">
                      Average order
                    </th>

                    <th className="px-5 py-3 text-right">
                      Share
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {pivotRows.map(
                    (row) => {
                      const share =
                        data.summary.revenue >
                        0
                          ? (row.revenue /
                              data.summary.revenue) *
                            100
                          : 0;

                      return (
                        <tr
                          key={row.key}
                          className="hover:bg-surface-2/60"
                        >
                          <td className="px-5 py-3 text-xs font-medium text-text">
                            {row.label}
                          </td>

                          <td className="px-5 py-3 text-right text-xs font-medium text-text">
                            {formatCurrency(
                              row.revenue
                            )}
                          </td>

                          <td className="px-5 py-3 text-right text-xs text-muted">
                            {row.orders}
                          </td>

                          <td className="px-5 py-3 text-right text-xs text-muted">
                            {formatCurrency(
                              row.average
                            )}
                          </td>

                          <td className="px-5 py-3 text-right text-xs text-muted">
                            {share.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    }
                  )}

                  <tr className="border-t border-border bg-surface-2/50">
                    <td className="px-5 py-3 text-xs font-semibold text-text">
                      Total
                    </td>

                    <td className="px-5 py-3 text-right text-xs font-semibold text-text">
                      {formatCurrency(
                        data.summary.revenue
                      )}
                    </td>

                    <td className="px-5 py-3 text-right text-xs font-semibold text-text">
                      {data.summary.orders}
                    </td>

                    <td className="px-5 py-3 text-right text-xs font-semibold text-text">
                      {formatCurrency(
                        data.summary.average_order
                      )}
                    </td>

                    <td className="px-5 py-3 text-right text-xs font-semibold text-text">
                      100%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}

      {/* ======================================================
          ORDERS
      ====================================================== */}

      {view === "orders" && data && (
        <section className="mt-4">
          <Card>
            <CardHeader
              title="Sales orders"
              subtitle={`${data.orders.length} confirmed orders`}
            />

            {data.orders.length === 0 ? (
              <SectionEmpty text="No confirmed orders for this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left">
                  <thead>
                    <tr className="border-b border-border text-[9px] uppercase tracking-[0.12em] text-muted">
                      <th className="px-5 py-3">
                        Order
                      </th>

                      <th className="px-5 py-3">
                        Customer
                      </th>

                      <th className="px-5 py-3">
                        Vehicle
                      </th>

                      <th className="px-5 py-3">
                        Vehicle category
                      </th>

                      <th className="px-5 py-3">
                        Date
                      </th>

                      <th className="px-5 py-3 text-right">
                        Revenue
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-border">
                    {data.orders.map(
                      (order) => (
                        <tr
                          key={order.id}
                          className="hover:bg-surface-2/60"
                        >
                          <td className="px-5 py-3 text-xs font-medium text-text">
                            {order.name}
                          </td>

                          <td className="px-5 py-3 text-xs text-muted">
                            {order.customer}
                          </td>

                          <td className="px-5 py-3 text-xs text-muted">
                            {order.vehicle ||
                              "—"}
                          </td>

                          <td className="px-5 py-3 text-xs text-muted">
                            {order.fleet_category}
                          </td>

                          <td className="px-5 py-3 text-xs text-muted">
                            {formatDate(
                              order.date
                            )}
                          </td>

                          <td className="px-5 py-3 text-right text-xs font-medium text-text">
                            {formatCurrency(
                              order.amount
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      )}
    </main>
  );
}
