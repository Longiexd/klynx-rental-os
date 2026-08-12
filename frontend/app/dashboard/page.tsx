"use client";

import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Car,
  ClipboardList,
  MoreHorizontal,
  TrendingUp,
  Users,
} from "lucide-react";
import React, { useEffect, useState } from "react";

// ==========================================================
// TYPES
// ==========================================================

type CarData = {
  id: number;
  name: string;
  license_plate: string | null;
  model: string | null;
  status: string | null;
};

type CustomerData = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  mobile: string | null;
};

type LeadData = {
  id: number;
  name: string;
  customer: string | null;
  phone: string | null;
  email: string | null;
  stage: string | null;
  created: string | null;
};

type CarsResponse = {
  count: number;
  cars: CarData[];
};

type CustomersResponse = {
  count: number;
  customers: CustomerData[];
};

type LeadsResponse = {
  count: number;
  leads: LeadData[];
};

// ==========================================================
// API CONFIGURATION
// ==========================================================

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://api.rental-os.example.com";

// ==========================================================
// TEMPORARY RENTAL DATA
// ==========================================================
// Rentals will become live once the backend exposes
// Odoo rental / reservation data.
// ==========================================================

const rentals = [
  {
    customer: "Rental data",
    vehicle: "Waiting for Odoo rental data",
    pickup: "--:--",
    returnDate: "--",
    status: "Upcoming",
  },
];

// ==========================================================
// TEMPORARY ACTIVITY DATA
// ==========================================================

const activity = [
  {
    time: "--:--",
    vehicle: "Rental activity",
    type: "Waiting for rental API",
    accent: "green",
  },
];

// ==========================================================
// DASHBOARD PAGE
// ==========================================================

export default function DashboardPage() {
  // ==========================================================
// DEBUG
// ==========================================================

console.log("KLYNX DASHBOARD LOADED");
console.log("API URL:", API_URL);

  const [cars, setCars] = useState<CarData[]>([]);
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const [leads, setLeads] = useState<LeadData[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ========================================================
  // FETCH DASHBOARD DATA
  // ========================================================

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        setError(null);

        const [carsResponse, customersResponse, leadsResponse] =
          await Promise.all([
            fetch(`${API_URL}/cars`, {
              cache: "no-store",
            }),

            fetch(`${API_URL}/customers`, {
              cache: "no-store",
            }),

            fetch(`${API_URL}/leads`, {
              cache: "no-store",
            }),
          ]);

        if (!carsResponse.ok) {
          throw new Error(
            `Cars API returned ${carsResponse.status}`
          );
        }

        if (!customersResponse.ok) {
          throw new Error(
            `Customers API returned ${customersResponse.status}`
          );
        }

        if (!leadsResponse.ok) {
          throw new Error(
            `Leads API returned ${leadsResponse.status}`
          );
        }

        const carsData: CarsResponse =
          await carsResponse.json();

        const customersData: CustomersResponse =
          await customersResponse.json();

        const leadsData: LeadsResponse =
          await leadsResponse.json();

        setCars(carsData.cars || []);
        setCustomers(customersData.customers || []);
        setLeads(leadsData.leads || []);
      } catch (err) {
        console.error("Dashboard API error:", err);

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load dashboard data."
        );
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  // ========================================================
  // DERIVED DATA
  // ========================================================

  const availableCars = cars.filter((car) => {
    const status = car.status?.toLowerCase() || "";

    return (
      status.includes("available") ||
      status.includes("ready") ||
      status.includes("available for rent")
    );
  }).length;

  // ========================================================
  // RENDER
  // ========================================================

  return (
    <main className="mx-auto max-w-[1500px] p-5 sm:p-8">

      {/* ====================================================
          HEADER
      ==================================================== */}

      <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">

        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] text-[#71717A]">
            <span>Workspace</span>
            <span>/</span>
            <span className="text-[#A1A1AA]">
              Overview
            </span>
          </div>

          <h1 className="font-[Syne] text-[26px] font-semibold tracking-[-0.035em] sm:text-[30px]">
            Good afternoon.
          </h1>

          <p className="mt-1 text-sm text-[#71717A]">
            Here&apos;s what&apos;s happening with your rental
            operation.
          </p>
        </div>

        <button className="flex h-9 items-center justify-center gap-2 rounded-lg bg-[#C8F065] px-4 text-xs font-medium text-[#09090B] shadow-[0_0_24px_rgba(200,240,101,.08)] transition hover:bg-[#d7ff80]">
          <ClipboardList size={14} />
          New rental
        </button>

      </section>

      {/* ====================================================
          API ERROR
      ==================================================== */}

      {error && (
        <div className="mt-4 rounded-xl border border-[#F06AAA]/30 bg-[#F06AAA]/5 px-4 py-3 text-xs text-[#F06AAA]">
          Unable to load live dashboard data: {error}
        </div>
      )}

      {/* ====================================================
          KPI CARDS
      ==================================================== */}

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">

        <StatCard
          label="Fleet"
          value={
            loading
              ? "—"
              : cars.length.toString()
          }
          detail="vehicles"
          change="Odoo"
          icon={<Car size={15} />}
          accent="green"
        />

        <StatCard
          label="Customers"
          value={
            loading
              ? "—"
              : customers.length.toString()
          }
          detail="in Odoo"
          change="Odoo"
          icon={<Users size={15} />}
          accent="green"
        />

        <StatCard
          label="Available"
          value={
            loading
              ? "—"
              : availableCars.toString()
          }
          detail="ready to rent"
          change="Odoo"
          icon={<Activity size={15} />}
          accent="pink"
        />

        <StatCard
          label="CRM Leads"
          value={
            loading
              ? "—"
              : leads.length.toString()
          }
          detail="active leads"
          change="Odoo"
          icon={<TrendingUp size={15} />}
          accent="green"
        />

      </section>

      {/* ====================================================
          MAIN GRID
      ==================================================== */}

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">

        {/* ==================================================
            FLEET OVERVIEW
        ================================================== */}

        <div className="overflow-hidden rounded-xl border border-[#2B2B30] bg-[#111113]/80">

          <div className="flex items-center justify-between border-b border-[#2B2B30] px-5 py-4">

            <div>
              <h2 className="font-[Syne] text-sm font-semibold">
                Fleet overview
              </h2>

              <p className="mt-1 text-[11px] text-[#71717A]">
                Live vehicle data from Odoo
              </p>
            </div>

            <a
              href="/dashboard/fleet"
              className="rounded-md border border-[#2B2B30] bg-[#17171A] px-2.5 py-1.5 text-[10px] text-[#A1A1AA] transition hover:text-white"
            >
              View fleet
            </a>

          </div>

          <div className="p-5">

            <div className="flex items-end justify-between">

              <div>
                <div className="font-[Syne] text-3xl font-semibold">
                  {loading
                    ? "—"
                    : cars.length}
                </div>

                <div className="mt-1 text-[11px] text-[#71717A]">
                  vehicles in Odoo
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-[#C8F065]">
                <Car size={13} />
                Live
              </div>

            </div>

            {/* ==================================================
                FLEET LIST
            ================================================== */}

            <div className="mt-7">

              {loading ? (

                <div className="space-y-3">

                  {[1, 2, 3, 4].map((item) => (
                    <div
                      key={item}
                      className="h-12 animate-pulse rounded-lg bg-[#17171A]"
                    />
                  ))}

                </div>

              ) : cars.length === 0 ? (

                <div className="rounded-lg border border-[#2B2B30] bg-[#17171A]/50 px-4 py-8 text-center text-xs text-[#71717A]">
                  No vehicles found in Odoo.
                </div>

              ) : (

                <div className="divide-y divide-[#2B2B30]">

                  {cars.slice(0, 6).map((car) => (

                    <div
                      key={car.id}
                      className="flex items-center gap-3 py-3"
                    >

                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#C8F065]/10 text-[#C8F065]">
                        <Car size={15} />
                      </div>

                      <div className="min-w-0 flex-1">

                        <div className="truncate text-xs font-medium">
                          {car.name ||
                            "Unnamed vehicle"}
                        </div>

                        <div className="mt-0.5 truncate text-[10px] text-[#71717A]">
                          {car.model ||
                            "No model"}

                          {car.license_plate
                            ? ` · ${car.license_plate}`
                            : ""}
                        </div>

                      </div>

                      <span className="rounded-md bg-[#17171A] px-2 py-1 text-[9px] text-[#A1A1AA]">
                        {car.status ||
                          "No status"}
                      </span>

                    </div>

                  ))}

                </div>

              )}

            </div>

          </div>

        </div>

        {/* ==================================================
            CRM LEADS
        ================================================== */}

        <div className="rounded-xl border border-[#2B2B30] bg-[#111113]/80">

          <div className="border-b border-[#2B2B30] px-5 py-4">

            <h2 className="font-[Syne] text-sm font-semibold">
              CRM leads
            </h2>

            <p className="mt-1 text-[11px] text-[#71717A]">
              Live leads from Odoo CRM
            </p>

          </div>

          <div className="divide-y divide-[#2B2B30]">

            {loading ? (

              [1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className="mx-5 h-12 animate-pulse bg-[#17171A]"
                />
              ))

            ) : leads.length === 0 ? (

              <div className="px-5 py-10 text-center text-xs text-[#71717A]">
                No CRM leads found.
              </div>

            ) : (

              leads.slice(0, 6).map((lead) => (

                <div
                  key={lead.id}
                  className="flex items-center gap-3 px-5 py-3.5"
                >

                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F06AAA]/10 text-[10px] text-[#F06AAA]">
                    {lead.name
                      ?.charAt(0)
                      ?.toUpperCase() ||
                      "L"}
                  </div>

                  <div className="min-w-0 flex-1">

                    <div className="truncate text-xs font-medium">
                      {lead.name ||
                        "Untitled lead"}
                    </div>

                    <div className="mt-0.5 truncate text-[10px] text-[#71717A]">
                      {lead.customer ||
                        "No customer"}
                    </div>

                  </div>

                  <span className="rounded-md bg-[#17171A] px-2 py-1 text-[9px] text-[#A1A1AA]">
                    {lead.stage ||
                      "No stage"}
                  </span>

                </div>

              ))

            )}

          </div>

        </div>

      </section>

      {/* ====================================================
          RECENT RENTALS
      ==================================================== */}

      <section className="mt-4 overflow-hidden rounded-xl border border-[#2B2B30] bg-[#111113]/80">

        <div className="flex items-center justify-between border-b border-[#2B2B30] px-5 py-4">

          <div>
            <h2 className="font-[Syne] text-sm font-semibold">
              Recent rentals
            </h2>

            <p className="mt-1 text-[11px] text-[#71717A]">
              Rental activity
            </p>
          </div>

          <button className="text-[11px] text-[#A1A1AA] transition hover:text-[#C8F065]">
            View all →
          </button>

        </div>

        <div className="overflow-x-auto">

          <table className="w-full min-w-[700px] text-left">

            <thead>

              <tr className="border-b border-[#2B2B30] text-[10px] uppercase tracking-wider text-[#71717A]">

                <th className="px-5 py-3 font-medium">
                  Customer
                </th>

                <th className="px-5 py-3 font-medium">
                  Vehicle
                </th>

                <th className="px-5 py-3 font-medium">
                  Pickup
                </th>

                <th className="px-5 py-3 font-medium">
                  Return
                </th>

                <th className="px-5 py-3 font-medium">
                  Status
                </th>

                <th className="px-5 py-3" />

              </tr>

            </thead>

            <tbody className="divide-y divide-[#2B2B30]">

              {rentals.map((rental) => (

                <tr
                  key={`${rental.customer}-${rental.vehicle}`}
                  className="text-xs transition hover:bg-[#17171A]/50"
                >

                  <td className="px-5 py-3.5 font-medium">
                    {rental.customer}
                  </td>

                  <td className="px-5 py-3.5 text-[#A1A1AA]">
                    {rental.vehicle}
                  </td>

                  <td className="px-5 py-3.5 text-[#A1A1AA]">
                    {rental.pickup}
                  </td>

                  <td className="px-5 py-3.5 text-[#A1A1AA]">
                    {rental.returnDate}
                  </td>

                  <td className="px-5 py-3.5">
                    <StatusBadge
                      status={rental.status}
                    />
                  </td>

                  <td className="px-5 py-3.5 text-right">

                    <button className="text-[#71717A] hover:text-white">
                      <MoreHorizontal size={15} />
                    </button>

                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

      </section>

      {/* ====================================================
          QUICK MODULES
      ==================================================== */}

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">

        <QuickModule
          icon={<Car size={17} />}
          title="Fleet"
          description="Manage vehicles, availability and maintenance."
          href="/dashboard/fleet"
        />

        <QuickModule
          icon={<Users size={17} />}
          title="Customers"
          description="Customers, documents and rental history."
          href="/dashboard/customers"
        />

        <QuickModule
          icon={<CalendarDays size={17} />}
          title="Calendar"
          description="See pickups, returns and upcoming reservations."
          href="/dashboard/calendar"
        />

      </section>

    </main>
  );
}

// ==========================================================
// STAT CARD
// ==========================================================

function StatCard({
  label,
  value,
  detail,
  change,
  icon,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  change: string;
  icon: React.ReactNode;
  accent: "green" | "pink";
}) {
  const isPink = accent === "pink";

  return (
    <div className="group relative overflow-hidden rounded-xl border border-[#2B2B30] bg-[#111113]/80 p-5 transition hover:border-[#3b3b42]">

      <div
        className={`pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full blur-3xl ${
          isPink
            ? "bg-[#F06AAA]/[0.05]"
            : "bg-[#C8F065]/[0.05]"
        }`}
      />

      <div className="relative">

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-2 text-[11px] text-[#71717A]">

            <span
              className={
                isPink
                  ? "text-[#F06AAA]"
                  : "text-[#C8F065]"
              }
            >
              {icon}
            </span>

            {label}

          </div>

          <span
            className={
              isPink
                ? "text-[10px] text-[#F06AAA]"
                : "text-[10px] text-[#C8F065]"
            }
          >
            {change}
          </span>

        </div>

        <div className="mt-5 flex items-baseline gap-2">

          <span className="font-[Syne] text-[26px] font-semibold tracking-[-0.03em]">
            {value}
          </span>

          <span className="text-[10px] text-[#71717A]">
            {detail}
          </span>

        </div>

      </div>

    </div>
  );
}

// ==========================================================
// STATUS BADGE
// ==========================================================

function StatusBadge({
  status,
}: {
  status: string;
}) {
  const styles = {
    Active: "bg-[#C8F065]/10 text-[#C8F065]",
    Returning: "bg-[#F06AAA]/10 text-[#F06AAA]",
    Upcoming: "bg-[#17171A] text-[#A1A1AA]",
  };

  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-[9px] ${
        styles[status as keyof typeof styles] ||
        "bg-[#17171A] text-[#A1A1AA]"
      }`}
    >
      {status}
    </span>
  );
}

// ==========================================================
// QUICK MODULE
// ==========================================================

function QuickModule({
  icon,
  title,
  description,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group rounded-xl border border-[#2B2B30] bg-[#111113]/60 p-4 transition hover:border-[#C8F065]/20 hover:bg-[#17171A]"
    >

      <div className="flex items-start justify-between">

        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#C8F065]/10 text-[#C8F065]">
          {icon}
        </div>

        <ArrowUpRight
          size={15}
          className="text-[#71717A] transition group-hover:text-[#C8F065]"
        />

      </div>

      <h3 className="mt-4 font-[Syne] text-sm font-semibold">
        {title}
      </h3>

      <p className="mt-1 text-[11px] leading-relaxed text-[#71717A]">
        {description}
      </p>

    </a>
  );
}
