"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { activityRequest, activityHref, noteText, type Activity } from "@/components/activities/api";
import {

  ArrowRight,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Clock3,
  UserRound,
  X,
  
} from "lucide-react";

import {
  getRentalState as classifyRentalState,
  rentalStateMeta,
  toneClasses,
} from "@/lib/status";
import { API_URL, apiRequest } from "@/lib/api-config";

// ============================================================
// TYPES
// ============================================================

type Customer = {
  id: number;
  name: string;
};

type Sale = {
  id: number;
  name: string;
  customer: Customer | null;
  state: string;
  date_order: string | null;
  commitment_date: string | null;
  amount_total: number;
  invoice_status: string;
  opportunity: {
    id: number;
    name: string;
  } | null;
  order_line_ids: number[];
  vehicle_id?: number | null;
  booking_status?: string;
  returned?: boolean;
  picked_up?: boolean;
  activity?: Activity;
};

type Vehicle = {
  id: number;
  name: string;
  license_plate: string | null;
  model?: string | null;
  status?: string | null;
  active?: boolean;
};

type CarsResponse = {
  count?: number;
  cars: Vehicle[];
};

type SalesResponse = {
  count: number;
  sales: Sale[];
};

type ViewMode =
  | "month"
  | "timeline"
  | "year";

type FleetStatus =
  | "available"
  | "rented"
  | "cleaning"
  | "maintenance"
  | "inactive"
  | "unknown";

// ============================================================
// CONFIG
// ============================================================

// ============================================================
// DATE HELPERS
// ============================================================

function parseDate(
  value: string | null
) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function startOfDay(date: Date) {
  const result = new Date(date);

  result.setHours(
    0,
    0,
    0,
    0
  );

  return result;
}

function endOfDay(date: Date) {
  const result = new Date(date);

  result.setHours(
    23,
    59,
    59,
    999
  );

  return result;
}

function isSameDay(
  a: Date,
  b: Date
) {
  return (
    a.getFullYear() ===
      b.getFullYear() &&
    a.getMonth() ===
      b.getMonth() &&
    a.getDate() ===
      b.getDate()
  );
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(
      date.getMonth() + 1
    ).padStart(2, "0"),
    String(
      date.getDate()
    ).padStart(2, "0"),
  ].join("-");
}

function formatDate(
  value: string | null
) {
  const date =
    parseDate(value);

  if (!date) {
    return "—";
  }

  return date.toLocaleDateString(
    "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  );
}

function formatMonth(
  date: Date
) {
  return date.toLocaleDateString(
    "en-US",
    {
      month: "long",
      year: "numeric",
    }
  );
}

function formatYear(
  date: Date
) {
  return String(
    date.getFullYear()
  );
}

function daysBetween(
  start: Date,
  end: Date
) {
  return Math.max(
    1,
    Math.round(
      (
        startOfDay(end).getTime() -
        startOfDay(start).getTime()
      ) /
        86400000
    ) + 1
  );
}

// ============================================================
// MONTH GRID
// ============================================================

function getCalendarDays(
  month: Date
) {
  const firstDay =
    new Date(
      month.getFullYear(),
      month.getMonth(),
      1
    );

  const lastDay =
    new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0
    );

  const mondayIndex =
    (firstDay.getDay() + 6) %
    7;

  const daysInMonth =
    lastDay.getDate();

  const totalCells =
    Math.ceil(
      (
        mondayIndex +
        daysInMonth
      ) / 7
    ) * 7;

  const days: Date[] = [];

  for (
    let index = 0;
    index < totalCells;
    index++
  ) {
    const day =
      new Date(firstDay);

    day.setDate(
      1 -
        mondayIndex +
        index
    );

    days.push(day);
  }

  return days;
}

function getMonthWeeks(
  month: Date
) {
  const days =
    getCalendarDays(month);

  const weeks: Date[][] = [];

  for (
    let i = 0;
    i < days.length;
    i += 7
  ) {
    weeks.push(
      days.slice(
        i,
        i + 7
      )
    );
  }

  return weeks;
}

// ============================================================
// FLEET STATUS
// ============================================================
//
// IMPORTANT:
//
// "Indisponible" is NOT treated as a standalone fleet state.
//
// Loué / Nettoyage / Maintenance are themselves unavailable
// states and receive a small red "Indisponible" tag.
//
// ============================================================

function getFleetStatus(
  status: string | null,
  active?: boolean
): FleetStatus {
  const value =
    status
      ?.toLowerCase()
      .trim() || "";

  if (active === false) {
    return "inactive";
  }

  if (
    value === "loué" ||
    value === "loue" ||
    value.includes("loué") ||
    value.includes("loue") ||
    value.includes("rented")
  ) {
    return "rented";
  }

  if (
    value === "disponible" ||
    value.includes("disponible") ||
    value.includes("available") ||
    value.includes("ready")
  ) {
    return "available";
  }

  if (
    value === "nettoyage" ||
    value.includes("nettoyage") ||
    value.includes("nettoy") ||
    value.includes("cleaning") ||
    value === "clean"
  ) {
    return "cleaning";
  }

  if (
    value === "maintenance" ||
    value.includes("maintenance") ||
    value.includes("entretien") ||
    value.includes("repair") ||
    value.includes("réparation") ||
    value.includes("reparation")
  ) {
    return "maintenance";
  }

  return "unknown";
}

// ============================================================
// STATUS META
// ============================================================

function getStatusMeta(
  status: FleetStatus,
  originalStatus: string | null
) {
  switch (status) {
    case "available":
      return {
        label: "Available",
        className:
          "border-[var(--status-available-border)] bg-[var(--status-available-bg)] text-[var(--status-available-text)]",
        text:
          "text-[var(--status-available-text)]",
        dot:
          "bg-[var(--status-available-text)]",
        border:
          "border-[var(--status-available-border)]",
        soft:
          "bg-[var(--status-available-text)]/5",
        unavailable:
          false,
      };

    case "rented":
      return {
        label: "Rented",
        className:
          "border-[var(--status-rented-border)] bg-[var(--status-rented-bg)] text-[var(--status-rented-text)]",
        text:
          "text-[var(--status-rented-text)]",
        dot:
          "bg-[var(--status-rented-text)]",
        border:
          "border-[var(--status-rented-border)]",
        soft:
          "bg-[var(--status-rented-text)]/5",
        unavailable:
          true,
      };

    case "cleaning":
      return {
        label: "Cleaning",
        className:
          "border-[var(--status-cleaning-border)] bg-[var(--status-cleaning-bg)] text-[var(--status-cleaning-text)]",
        text:
          "text-[var(--status-cleaning-text)]",
        dot:
          "bg-[var(--status-cleaning-text)]",
        border:
          "border-[var(--status-cleaning-border)]",
        soft:
          "bg-[var(--status-cleaning-text)]/5",
        unavailable:
          true,
      };

    case "maintenance":
      return {
        label: "Maintenance",
        className:
          "border-[var(--status-maintenance-border)] bg-[var(--status-maintenance-bg)] text-[var(--status-maintenance-text)]",
        text:
          "text-[var(--status-maintenance-text)]",
        dot:
          "bg-[var(--status-maintenance-text)]",
        border:
          "border-[var(--status-maintenance-border)]",
        soft:
          "bg-[var(--status-maintenance-text)]/5",
        unavailable:
          true,
      };

    case "inactive":
      return {
        label: "Inactive",
        className:
          "border-zinc-600/30 bg-zinc-700/20 text-muted",
        text:
          "text-muted",
        dot:
          "bg-zinc-600",
        border:
          "border-zinc-600/30",
        soft:
          "bg-zinc-700/10",
        unavailable:
          true,
      };

    default:
      return {
        label:
          originalStatus ||
          "Undefined",
        className:
          "border-border bg-surface-secondary text-text-secondary",
        text:
          "text-text-secondary",
        dot:
          "bg-zinc-600",
        border:
          "border-border",
        soft:
          "bg-surface-secondary",
        unavailable:
          false,
      };
  }
}

// ============================================================
// RENTAL COLOR
//
// Thin wrapper around the shared lib/status.ts registry. This
// used to pick blue for draft/quotation bookings, which visually
// collided with the fleet 'Cleaning' status (also blue) elsewhere
// on this same calendar — a booking and a vehicle being cleaned
// looked identical at a glance. The shared registry uses a
// distinct muted/gray for draft state instead.
// ============================================================

function getRentalState(sale: Sale) {
  if (sale.activity) return { className: "border-[var(--todo-border)] bg-[var(--todo-bg)] text-[var(--todo-text)]", dot: "bg-[var(--todo-text)]" };
  const meta = rentalStateMeta(classifyRentalState(sale));
  const classes = toneClasses(meta.tone);

  return {
    className: `${classes.border} ${classes.bg} ${classes.text}`,
    dot: classes.dot,
  };
}

// ============================================================
// RENTAL OVERLAP
// ============================================================

function rentalOverlapsDay(
  rental: Sale,
  day: Date
) {
  const start =
    parseDate(
      rental.date_order
    );

  const end =
    parseDate(
      rental.commitment_date
    );

  if (!start || !end) {
    return false;
  }

  return (
    startOfDay(day) <=
      endOfDay(end) &&
    endOfDay(day) >=
      startOfDay(start)
  );
}

function rentalOverlapsRange(
  rental: Sale,
  rangeStart: Date,
  rangeEnd: Date
) {
  const start =
    parseDate(
      rental.date_order
    );

  const end =
    parseDate(
      rental.commitment_date
    );

  if (!start || !end) {
    return false;
  }

  return (
    start <= rangeEnd &&
    end >= rangeStart
  );
}

// ============================================================
// RENTAL MODAL
// ============================================================

function RentalModal({
  rental,
  vehicle,
  onClose,
}: {
  rental: Sale;
  vehicle: Vehicle | null;
  onClose: () => void;
}) {
  const rentalState =
    getRentalState(
      rental
    );

  const start =
    parseDate(
      rental.date_order
    );

  const end =
    parseDate(
      rental.commitment_date
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close rental"
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-md"
      />

      <div className="relative z-10 max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl shadow-black/60">

        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-text">
              Rental details
            </div>

            <div className="mt-1 font-mono text-[10px] text-muted">
              {rental.name}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-5">

          <div className="flex items-center justify-between">
            <span
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${rentalState.className}`}
            >
              {rentalStateMeta(classifyRentalState(rental)).label}
            </span>

            <span className="font-mono text-[10px] text-muted">
              Booking #{rental.id}
            </span>
          </div>

          {/* VEHICLE */}

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted">
              Vehicle
            </div>

            {vehicle ? (
              <Link
                href={`/dashboard/fleet?vehicle=${vehicle.id}`}
                onClick={onClose}
                className="mt-3 flex items-center gap-3"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface-secondary">
                  <Car
                    size={17}
                    className="text-text-secondary"
                  />
                </div>

                <div>
                  <div className="text-sm font-semibold text-text hover:text-[var(--status-available-text)]">
                    {vehicle.model ||
                      vehicle.name}
                  </div>

                  <div className="mt-1 text-xs text-muted">
                    {vehicle.name}

                    {vehicle.license_plate && (
                      <>
                        {" "}
                        •{" "}
                        <span className="font-mono">
                          {
                            vehicle.license_plate
                          }
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </Link>
            ) : (
              <div className="mt-3 text-sm text-muted">
                Vehicle not linked
              </div>
            )}
          </div>

          {/* CUSTOMER */}

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted">
              Customer
            </div>

            {rental.customer ? (
              <Link
                href={`/dashboard/customers/${rental.customer.id}`}
                onClick={onClose}
                className="mt-3 flex items-center gap-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--status-rented-border)] bg-[var(--status-rented-text)]/10">
                  <UserRound
                    size={16}
                    className="text-[var(--status-rented-text)]"
                  />
                </div>

                <div className="text-sm font-semibold text-text hover:text-[var(--status-available-text)]">
                  {
                    rental.customer
                      .name
                  }
                </div>
              </Link>
            ) : (
              <div className="mt-3 text-sm text-muted">
                No customer linked
              </div>
            )}
          </div>

          {/* PERIOD */}

          <div className="grid grid-cols-2 gap-3">

            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="text-[9px] uppercase tracking-[0.14em] text-muted">
                Pickup
              </div>

              <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-text">
                <CalendarDays
                  size={14}
                  className="text-muted"
                />

                {formatDate(
                  rental.date_order
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="text-[9px] uppercase tracking-[0.14em] text-muted">
                Return
              </div>

              <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-text">
                <Clock3
                  size={14}
                  className="text-muted"
                />

                {formatDate(
                  rental.commitment_date
                )}
              </div>
            </div>

          </div>

          {start &&
            end && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="text-[9px] uppercase tracking-[0.14em] text-muted">
                  Rental period
                </div>

                <div className="mt-2 text-sm font-semibold text-text">
                  {daysBetween(
                    start,
                    end
                  )}{" "}
                  {daysBetween(
                    start,
                    end
                  ) === 1
                    ? "day"
                    : "days"}
                </div>
              </div>
            )}

          <Link
            href={`/dashboard/rentals/${rental.id}`}
            onClick={onClose}
            className="flex h-11 items-center justify-between rounded-xl bg-lime px-4 text-xs font-semibold text-black hover:bg-lime-dark"
          >
            {rental.picked_up ? "View rental / return" : "Open booking / confirm pickup"}
            <ArrowRight
              size={14}
            />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MONTH RENTAL BAR
// ============================================================
//
// IMPORTANT:
// This is NOT rendered once per day.
//
// Each rental becomes ONE continuous element across the
// relevant columns of the week.
//
// ============================================================

function MonthRentalBar({
  rental,
  vehicle,
  week,
  onClick,
}: {
  rental: Sale;
  vehicle: Vehicle | null;
  week: Date[];
  onClick: () => void;
}) {
  const start =
    parseDate(
      rental.date_order
    );

  const end =
    parseDate(
      rental.commitment_date
    );

  if (!start || !end) {
    return null;
  }

  const weekStart =
    startOfDay(
      week[0]
    );

  const weekEnd =
    endOfDay(
      week[6]
    );

  if (
    end < weekStart ||
    start > weekEnd
  ) {
    return null;
  }

  const visibleStart =
    start < weekStart
      ? weekStart
      : startOfDay(start);

  const visibleEnd =
    end > weekEnd
      ? weekEnd
      : endOfDay(end);

  const startIndex =
    Math.max(
      0,
      Math.floor(
        (
          visibleStart.getTime() -
          weekStart.getTime()
        ) /
          86400000
      )
    );

  const endIndex =
    Math.min(
      6,
      Math.floor(
        (
          visibleEnd.getTime() -
          weekStart.getTime()
        ) /
          86400000
      )
    );

  const span =
    endIndex -
    startIndex +
    1;

  const rentalState =
    getRentalState(
      rental
    );

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rental.activity ? `${rental.name} · ${rental.activity.res_name}` : `${rentalStateMeta(classifyRentalState(rental)).label} · ${rental.name} · ${vehicle?.name || "Rental"} · ${rental.customer?.name || ""}`}
      className={`absolute z-20 flex h-9 items-center overflow-hidden rounded-lg border px-2.5 text-left shadow-sm transition hover:z-30 hover:brightness-110 ${rentalState.className}`}
      style={{
        left: `calc(${startIndex} * (100% / 7) + 4px)`,
        width: `calc(${span} * (100% / 7) - 8px)`,
      }}
    >
      <span
        className={`mr-2 h-1.5 w-1.5 shrink-0 rounded-full ${rentalState.dot}`}
      />

      <span className="truncate text-[10px] font-semibold">
        {!rental.activity && classifyRentalState(rental) === "pickup_due" ? `Pickup due · ${vehicle?.model || vehicle?.name || "Rental"}` : rental.activity?.summary || vehicle?.model ||
          vehicle?.name ||
          "Rental"}
      </span>

      {span >= 3 &&
        rental.customer && (
          <span className="ml-2 truncate text-[9px] opacity-70">
            {
              rental.customer
                .name
            }
          </span>
        )}
    </button>
  );
}

// ============================================================
// MONTH VIEW
// ============================================================

function MonthView({
  month,
  sales,
  vehicleMap,
  onRentalClick,
}: {
  month: Date;
  sales: Sale[];
  vehicleMap: Map<number, Vehicle>;
  onRentalClick: (rental: Sale) => void;
}) {
  const weeks = getMonthWeeks(month);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      {/* WEEKDAY HEADER */}
      <div className="grid grid-cols-7 border-b border-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <div
            key={day}
            className="flex h-11 items-center justify-center border-r border-border text-[9px] font-semibold uppercase tracking-[0.14em] text-muted last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      {/* WEEK ROWS */}
      {weeks.map((week, weekIndex) => {
        const weekStart = startOfDay(week[0]);
        const weekEnd = endOfDay(week[6]);
        const weekSales = sales.filter((sale) => rentalOverlapsRange(sale, weekStart, weekEnd));
        const today = new Date();

        // Build collision-free lanes for this week. A rental only shares a lane
        // when its visible date span does not overlap the previous item in it.
        // The week row grows with the number of lanes, so bars never spill into
        // the following week or visually detach from their dates.
        const segments = weekSales
          .map((rental) => {
            const start = parseDate(rental.date_order);
            const end = parseDate(rental.commitment_date);
            if (!start || !end) return null;

            const visibleStart = start < weekStart ? weekStart : startOfDay(start);
            const visibleEnd = end > weekEnd ? weekEnd : endOfDay(end);
            const startIndex = Math.max(
              0,
              Math.min(6, Math.floor((visibleStart.getTime() - weekStart.getTime()) / 86400000))
            );
            const endIndex = Math.max(
              startIndex,
              Math.min(6, Math.floor((visibleEnd.getTime() - weekStart.getTime()) / 86400000))
            );

            return { rental, startIndex, endIndex };
          })
          .filter((item): item is { rental: Sale; startIndex: number; endIndex: number } => item !== null)
          .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex || a.rental.id - b.rental.id);

        const laneEnds: number[] = [];
        const laidOut = segments.map((segment) => {
          let lane = laneEnds.findIndex((lastEnd) => lastEnd < segment.startIndex);
          if (lane === -1) lane = laneEnds.length;
          laneEnds[lane] = segment.endIndex;
          return { ...segment, lane };
        });

        const laneCount = Math.max(1, laneEnds.length);
        const rowHeight = Math.max(150, 52 + laneCount * 38);

        return (
          <div
            key={`week-${weekIndex}`}
            className="relative border-b border-border last:border-b-0"
          >
            {/* DAY CELLS */}
            <div className="grid grid-cols-7">
              {week.map((day) => {
                const inMonth = day.getMonth() === month.getMonth();
                const daySales = weekSales.filter((sale) => rentalOverlapsDay(sale, day));

                return (
                  <div
                    key={dateKey(day)}
                    style={{ minHeight: `${rowHeight}px` }}
                    className={`border-r border-border p-2 last:border-r-0 ${
                      inMonth ? "bg-surface" : "bg-background"
                    } ${
                      isSameDay(day, today)
                        ? "bg-[var(--status-available-text)]/[0.025]"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold ${
                          isSameDay(day, today)
                            ? "bg-lime text-black"
                            : inMonth
                              ? "text-text"
                              : "text-muted"
                        }`}
                      >
                        {day.getDate()}
                      </span>

                      {daySales.length > 0 && (
                        <span className="text-[9px] font-medium text-muted">{daySales.length}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* CONTINUOUS RENTAL LAYER */}
            <div
              className="pointer-events-none absolute inset-x-0 top-[43px]"
              style={{ height: `${Math.max(96, rowHeight - 43)}px` }}
            >
              {laidOut.map(({ rental, lane }) => (
                <div
                  key={rental.id}
                  className="pointer-events-auto absolute inset-x-0"
                  style={{ top: `${lane * 38}px` }}
                >
                  <MonthRentalBar
                    rental={rental}
                    vehicle={rental.vehicle_id ? vehicleMap.get(rental.vehicle_id) || null : null}
                    week={week}
                    onClick={() => onRentalClick(rental)}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// TIMELINE VIEW
// ============================================================

function TimelineView({
  month,
  vehicles,
  sales,
  onRentalClick,
}: {
  month: Date;
  vehicles: Vehicle[];
  sales: Sale[];
  vehicleMap: Map<
    number,
    Vehicle
  >;
  onRentalClick: (
    rental: Sale
  ) => void;
}) {
  const daysInMonth =
    new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0
    ).getDate();

  const days =
    Array.from(
      {
        length:
          daysInMonth,
      },
      (_, index) =>
        new Date(
          month.getFullYear(),
          month.getMonth(),
          index + 1
        )
    );

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">

      <div className="overflow-x-auto">

        <div
          className="min-w-max"
          style={
            {
              "--day-width":
                "72px",
            } as React.CSSProperties
          }
        >

          {/* HEADER */}

          <div className="flex border-b border-border">

            <div className="sticky left-0 z-30 flex h-14 w-[240px] shrink-0 items-center border-r border-border bg-surface px-5">
              <div>
                <div className="text-[9px] uppercase tracking-[0.14em] text-muted">
                  Fleet
                </div>

                <div className="mt-1 text-xs font-semibold text-text">
                  Vehicle
                </div>
              </div>
            </div>

            <div className="flex">
              {days.map(
                (day) => (
                  <div
                    key={dateKey(
                      day
                    )}
                    className={`flex h-14 w-[72px] shrink-0 flex-col items-center justify-center border-r border-border ${
                      isSameDay(
                        day,
                        new Date()
                      )
                        ? "bg-[var(--status-available-text)]/[0.04]"
                        : ""
                    }`}
                  >
                    <span className="text-[8px] uppercase text-muted">
                      {day.toLocaleDateString(
                        "en-US",
                        {
                          weekday:
                            "short",
                        }
                      )}
                    </span>

                    <span
                      className={`mt-1 text-xs font-semibold ${
                        isSameDay(
                          day,
                          new Date()
                        )
                          ? "text-[var(--status-available-text)]"
                          : "text-text-secondary"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>

          {/* VEHICLE ROWS */}

          {vehicles.map(
            (vehicle) => {
              const vehicleSales =
                sales.filter(
                  (sale) =>
                    sale.vehicle_id ===
                    vehicle.id &&
                    sale.state !==
                      "cancel"
                );

              const status =
                getFleetStatus(
                  vehicle.status ?? null,
                  vehicle.active
                );

              const meta =
                getStatusMeta(
                  status,
                  vehicle.status ||
                    null
                );

              return (
                <div
                  key={
                    vehicle.id
                  }
                  className="flex h-[82px] border-b border-border"
                >

                  {/* VEHICLE */}

                  <Link
                    href={`/dashboard/fleet?vehicle=${vehicle.id}`}
                    className="sticky left-0 z-20 flex w-[240px] shrink-0 items-center gap-3 border-r border-border bg-surface px-5 hover:bg-surface-secondary"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-secondary">
                      <Car
                        size={15}
                        className={
                          meta.text
                        }
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-text">
                        {vehicle.model ||
                          vehicle.name}
                      </div>

                      <div className="mt-1 truncate font-mono text-[9px] text-muted">
                        {vehicle.license_plate ||
                          vehicle.name}
                      </div>
                    </div>
                  </Link>

                  {/* TIMELINE */}

                  <div
                    className="relative h-[82px] shrink-0"
                    style={{
                      width: `calc(${daysInMonth} * var(--day-width))`,
                    }}
                  >

                    {/* GRID */}

                    <div className="absolute inset-0 flex">
                      {days.map(
                        (day) => (
                          <div
                            key={dateKey(
                              day
                            )}
                            className={`h-full w-[72px] shrink-0 border-r border-border/60 ${
                              isSameDay(
                                day,
                                new Date()
                              )
                                ? "bg-[var(--status-available-text)]/[0.025]"
                                : ""
                            }`}
                          />
                        )
                      )}
                    </div>

                    {/* RENTALS */}

                    {vehicleSales.map(
                      (rental) => {
                        const start =
                          parseDate(
                            rental.date_order
                          );

                        const end =
                          parseDate(
                            rental.commitment_date
                          );

                        if (
                          !start ||
                          !end
                        ) {
                          return null;
                        }

                        const monthStart =
                          startOfDay(
                            new Date(
                              month.getFullYear(),
                              month.getMonth(),
                              1
                            )
                          );

                        const monthEnd =
                          endOfDay(
                            new Date(
                              month.getFullYear(),
                              month.getMonth() +
                                1,
                              0
                            )
                          );

                        if (
                          end <
                            monthStart ||
                          start >
                            monthEnd
                        ) {
                          return null;
                        }

                        const visibleStart =
                          start <
                          monthStart
                            ? monthStart
                            : startOfDay(
                                start
                              );

                        const visibleEnd =
                          end >
                          monthEnd
                            ? monthEnd
                            : endOfDay(
                                end
                              );

                        const startDay =
                          Math.max(
                            0,
                            Math.floor(
                              (
                                visibleStart.getTime() -
                                monthStart.getTime()
                              ) /
                                86400000
                            )
                          );

                        const endDay =
                          Math.min(
                            daysInMonth -
                              1,
                            Math.floor(
                              (
                                visibleEnd.getTime() -
                                monthStart.getTime()
                              ) /
                                86400000
                            )
                          );

                        const span =
                          endDay -
                          startDay +
                          1;

                        const rentalState =
                          getRentalState(
                            rental
                          );

                        return (
                          <button
                            key={
                              rental.id
                            }
                            type="button"
                            onClick={() =>
                              onRentalClick(
                                rental
                              )
                            }
                            className={`absolute top-1/2 z-10 flex h-10 -translate-y-1/2 items-center overflow-hidden rounded-lg border px-3 text-left shadow-lg transition hover:z-20 hover:brightness-110 ${rentalState.className}`}
                            style={{
                              left: `calc(${startDay} * var(--day-width) + 5px)`,
                              width: `calc(${span} * var(--day-width) - 10px)`,
                            }}
                          >
                            <span
                              className={`mr-2 h-1.5 w-1.5 shrink-0 rounded-full ${rentalState.dot}`}
                            />

                            <span className="truncate text-[10px] font-semibold">
                              {rental.customer?.name ||
                                "Rental"}
                            </span>
                          </button>
                        );
                      }
                    )}

                    {vehicleSales.length ===
                      0 && (
                      <div
                        className={`absolute inset-y-0 left-0 flex items-center px-5 text-[9px] ${meta.text} opacity-50`}
                      >
                        {
                          meta.label
                        }

                        {meta.unavailable && (
                          <span className="ml-2 rounded-full border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-wider text-red-400">
                            Unavailable
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
          )}

          {vehicles.length ===
            0 && (
            <div className="flex h-72 items-center justify-center text-sm text-muted">
              No vehicles found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// YEAR VIEW
// ============================================================

function YearView({
  year,
  sales,
  onMonthClick,
}: {
  year: number;
  sales: Sale[];
  vehicles: Vehicle[];
  vehicleMap: Map<
    number,
    Vehicle
  >;
  onMonthClick: (
    monthIndex: number
  ) => void;
  onRentalClick: (
    rental: Sale
  ) => void;
}) {
  const months =
    Array.from(
      { length: 12 },
      (_, index) =>
        new Date(
          year,
          index,
          1
        )
    );

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">

      {months.map(
        (
          month,
          monthIndex
        ) => {
          const monthStart =
            startOfDay(
              new Date(
                year,
                monthIndex,
                1
              )
            );

          const monthEnd =
            endOfDay(
              new Date(
                year,
                monthIndex + 1,
                0
              )
            );

          const monthSales =
            sales.filter(
              (sale) =>
                rentalOverlapsRange(
                  sale,
                  monthStart,
                  monthEnd
                )
            );

          const rentedVehicleIds =
            new Set(
              monthSales
                .map(
                  (sale) =>
                    sale.vehicle_id
                )
                .filter(
                  (
                    id
                  ): id is number =>
                    typeof id ===
                    "number"
                )
            );

          const daysInMonth =
            new Date(
              year,
              monthIndex + 1,
              0
            ).getDate();

          return (
            <button
              key={
                monthIndex
              }
              type="button"
              onClick={() =>
                onMonthClick(
                  monthIndex
                )
              }
              className="group rounded-2xl border border-border bg-surface p-4 text-left transition hover:border-zinc-600 hover:bg-surface"
            >

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-text">
                    {month.toLocaleDateString(
                      "en-US",
                      {
                        month:
                          "long",
                      }
                    )}
                  </div>

                  <div className="mt-1 text-[9px] text-muted">
                    {
                      monthSales.length
                    }{" "}
                    rentals
                  </div>
                </div>

                <ChevronRight
                  size={15}
                  className="text-muted transition group-hover:text-text-secondary"
                />
              </div>

              {/* MINI CALENDAR */}

              <div className="mt-4 grid grid-cols-7 gap-1">

                {[
                  "M",
                  "T",
                  "W",
                  "T",
                  "F",
                  "S",
                  "S",
                ].map(
                  (
                    day,
                    index
                  ) => (
                    <div
                      key={`${day}-${index}`}
                      className="flex h-5 items-center justify-center text-[7px] font-semibold text-muted"
                    >
                      {day}
                    </div>
                  )
                )}

                {getCalendarDays(
                  month
                ).map(
                  (day) => {
                    const count =
                      monthSales.filter(
                        (
                          sale
                        ) =>
                          rentalOverlapsDay(
                            sale,
                            day
                          )
                      ).length;

                    const inMonth =
                      day.getMonth() ===
                      monthIndex;

                    return (
                      <div
                        key={dateKey(
                          day
                        )}
                        className={`relative flex h-7 items-center justify-center rounded-md text-[8px] ${
                          inMonth
                            ? "text-muted"
                            : "text-muted"
                        } ${
                          count >
                          0
                            ? "bg-[var(--status-rented-text)]/10"
                            : "bg-surface-secondary/50"
                        }`}
                      >
                        {day.getDate()}

                        {count >
                          0 && (
                          <span className="absolute bottom-1 h-0.5 w-0.5 rounded-full bg-[var(--status-rented-text)]" />
                        )}
                      </div>
                    );
                  }
                )}
              </div>

              {/* MONTH SUMMARY */}

              <div className="mt-4 grid grid-cols-3 gap-2">

                <div className="rounded-xl border border-border bg-background p-2.5">
                  <div className="text-[8px] uppercase tracking-wider text-muted">
                    Rentals
                  </div>

                  <div className="mt-1 text-sm font-semibold text-[var(--status-rented-text)]">
                    {
                      monthSales.length
                    }
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-background p-2.5">
                  <div className="text-[8px] uppercase tracking-wider text-muted">
                    Cars
                  </div>

                  <div className="mt-1 text-sm font-semibold text-text">
                    {
                      rentedVehicleIds.size
                    }
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-background p-2.5">
                  <div className="text-[8px] uppercase tracking-wider text-muted">
                    Days
                  </div>

                  <div className="mt-1 text-sm font-semibold text-text">
                    {
                      daysInMonth
                    }
                  </div>
                </div>

              </div>
            </button>
          );
        }
      )}
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================

export default function CalendarPage() {
  const router = useRouter();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [eventFilter, setEventFilter] = useState("all");
  const [activityError, setActivityError] = useState("");
  useEffect(() => {
    let active = true;
    activityRequest<{ activities: Activity[] }>("/activities")
      .then(result => { if (active) setActivities(result.activities); })
      .catch(err => { if (active) setActivityError(err instanceof Error ? err.message : "Unable to load activities."); });
    return () => { active = false; };
  }, []);
  const [
    sales,
    setSales,
  ] = useState<Sale[]>([]);

  const [
    vehicles,
    setVehicles,
  ] = useState<Vehicle[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null
  );

  const [
    month,
    setMonth,
  ] = useState(
    () => new Date()
  );

  const [
    view,
    setView,
  ] = useState<ViewMode>(
    "month"
  );

  const [
    selectedVehicle,
    setSelectedVehicle,
  ] = useState(
    "all"
  );

  const [
    selectedRental,
    setSelectedRental,
  ] = useState<Sale | null>(
    null
  );

  // ==========================================================
  // READ VEHICLE FROM URL
  // ==========================================================

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const vehicle =
      params.get(
        "vehicle"
      );

    if (vehicle) {
      setSelectedVehicle(
        vehicle
      );
    }
  }, []);

  // ==========================================================
  // FETCH ODOO DATA
  // ==========================================================

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [
          salesResponse,
          carsResponse,
        ] = await Promise.all([
          apiRequest(
            `${API_URL}/sales?for_calendar=true`,
            {
              cache:
                "no-store",
            }
          ),
          apiRequest(
            `${API_URL}/cars`,
            {
              cache:
                "no-store",
            }
          ),
        ]);

        if (
          !salesResponse.ok
        ) {
          throw new Error(
            `Sales API returned ${salesResponse.status}`
          );
        }

        if (
          !carsResponse.ok
        ) {
          throw new Error(
            `Cars API returned ${carsResponse.status}`
          );
        }

        const salesData: SalesResponse =
          await salesResponse.json();

        const carsData: CarsResponse =
          await carsResponse.json();

        setSales(
          salesData.sales ||
            []
        );

        setVehicles(
          carsData.cars ||
            []
        );
      } catch (err) {
        console.error(err);

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load calendar."
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  // ==========================================================
  // VEHICLE MAP
  // ==========================================================

  const vehicleMap =
    useMemo(
      () =>
        new Map(
          vehicles.map(
            (vehicle) => [
              vehicle.id,
              vehicle,
            ]
          )
        ),
      [vehicles]
    );

  // ==========================================================
  // FILTER
  // ==========================================================

  const visibleVehicles =
    useMemo(() => {
      if (
        selectedVehicle ===
        "all"
      ) {
        return vehicles;
      }

      return vehicles.filter(
        (vehicle) =>
          vehicle.id ===
          Number(
            selectedVehicle
          )
      );
    }, [
      vehicles,
      selectedVehicle,
    ]);

  const activitySales: Sale[] = activities.map(activity => ({
    id: -activity.id, name: activity.summary || "Follow up", customer: { id: activity.res_id, name: activity.res_name },
    state: "activity", date_order: activity.date_deadline, commitment_date: activity.date_deadline,
    amount_total: 0, invoice_status: "", opportunity: null, order_line_ids: [], activity,
  }));
  const visibleSales = [
    ...(eventFilter === "todo" ? [] : sales.filter(sale => sale.state !== "cancel" && sale.booking_status !== "cancelled" &&
      (selectedVehicle === "all" || sale.vehicle_id === Number(selectedVehicle)))),
    ...(eventFilter === "rentals" ? [] : activitySales),
  ];

  // ==========================================================
  // STATS
  // ==========================================================

  const fleetStats =
    useMemo(() => {
      const stats = {
        total:
          visibleVehicles.length,
        available: 0,
        rented: 0,
        cleaning: 0,
        maintenance: 0,
        inactive: 0,
      };

      for (
        const vehicle of visibleVehicles
      ) {
        const status =
          getFleetStatus(
            vehicle.status ||
              null,
            vehicle.active
          );

        if (
          status ===
          "available"
        ) {
          stats.available++;
        }

        if (
          status ===
          "rented"
        ) {
          stats.rented++;
        }

        if (
          status ===
          "cleaning"
        ) {
          stats.cleaning++;
        }

        if (
          status ===
          "maintenance"
        ) {
          stats.maintenance++;
        }

        if (
          status ===
          "inactive"
        ) {
          stats.inactive++;
        }
      }

      return stats;
    }, [
      visibleVehicles,
    ]);

  // ==========================================================
  // NAVIGATION
  // ==========================================================

  function previousMonth() {
    setMonth(
      (current) =>
        new Date(
          current.getFullYear(),
          current.getMonth() - 1,
          1
        )
    );
  }

  function nextMonth() {
    setMonth(
      (current) =>
        new Date(
          current.getFullYear(),
          current.getMonth() + 1,
          1
        )
    );
  }

  function goToday() {
    setMonth(
      new Date()
    );
  }

  // ==========================================================
  // YEAR VIEW -> MONTH
  // ==========================================================

  function openYearMonth(
    monthIndex: number
  ) {
    setMonth(
      new Date(
        month.getFullYear(),
        monthIndex,
        1
      )
    );

    setView("month");
  }

  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 text-text">
        <div className="mx-auto max-w-[1900px]">
          <div className="h-8 w-56 animate-pulse rounded-lg bg-surface-secondary" />

          <div className="mt-6 h-[720px] animate-pulse rounded-2xl border border-border bg-surface" />
        </div>
      </div>
    );
  }

  // ==========================================================
  // ERROR
  // ==========================================================

  if (error) {
    return (
      <div className="min-h-screen bg-background p-6 text-text">
        <div className="mx-auto max-w-[1900px]">
          <div className="rounded-2xl border border-red-400/20 bg-red-400/5 p-6">
            <div className="text-sm font-semibold text-danger">
              Unable to load calendar
            </div>

            <div className="mt-2 text-xs text-muted">
              {error}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <div className="min-h-screen bg-background text-text">

      <div className="mx-auto max-w-[1900px] p-4 sm:p-6 lg:p-8">

        {/* ====================================================
            HEADER
        ==================================================== */}

        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">

          <div>
            <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.16em] text-muted">
              <CalendarDays
                size={13}
              />
              Operations
            </div>

            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
              Rental Calendar
            </h1>

            <p className="mt-2 max-w-xl text-sm text-muted">
              Plan rentals, follow vehicle
              availability and see your fleet
              at a glance.
            </p>
          </div>

          {/* CONTROLS */}

          <div className="flex flex-wrap items-center gap-2">

            {view !==
              "year" && (
              <>
                <button
                  type="button"
                  onClick={
                    goToday
                  }
                  className="h-10 rounded-xl border border-border bg-surface px-4 text-xs font-medium text-text-secondary hover:border-zinc-600 hover:text-text"
                >
                  Today
                </button>

                <button
                  type="button"
                  onClick={
                    previousMonth
                  }
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-muted hover:border-zinc-600 hover:text-text"
                >
                  <ChevronLeft
                    size={16}
                  />
                </button>

                <div className="flex h-10 min-w-[175px] items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold">
                  {formatMonth(
                    month
                  )}
                </div>

                <button
                  type="button"
                  onClick={
                    nextMonth
                  }
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-muted hover:border-zinc-600 hover:text-text"
                >
                  <ChevronRight
                    size={16}
                  />
                </button>
              </>
            )}

            {view ===
              "year" && (
              <div className="flex h-10 items-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold">
                {formatYear(
                  month
                )}
              </div>
            )}

            <select
              value={
                selectedVehicle
              }
              onChange={(
                event
              ) =>
                setSelectedVehicle(
                  event.target
                    .value
                )
              }
              className="h-10 max-w-[190px] rounded-xl border border-border bg-surface px-3 text-xs font-medium text-text outline-none hover:border-zinc-600"
            >
              <option value="all">
                All vehicles
              </option>

              {vehicles.map(
                (vehicle) => (
                  <option
                    key={
                      vehicle.id
                    }
                    value={
                      vehicle.id
                    }
                  >
                    {vehicle.name}
                  </option>
                )
              )}
            </select>
          </div>
        </div>

        {/* ====================================================
            FLEET SNAPSHOT
        ==================================================== */}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">

          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted">
              Fleet
            </div>

            <div className="mt-2 text-xl font-semibold">
              {fleetStats.total}
            </div>
          </div>

          <div className="rounded-2xl border border-[#C8F065]/10 bg-[var(--status-available-text)]/[0.025] p-4">
            <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--status-available-text)]">
              Available
            </div>

            <div className="mt-2 text-xl font-semibold text-[var(--status-available-text)]">
              {
                fleetStats.available
              }
            </div>
          </div>

          <div className="rounded-2xl border border-[#F06AAA]/10 bg-[var(--status-rented-text)]/[0.025] p-4">
            <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--status-rented-text)]">
              Rented
            </div>

            <div className="mt-2 text-xl font-semibold text-[var(--status-rented-text)]">
              {
                fleetStats.rented
              }
            </div>
          </div>

          <div className="rounded-2xl border border-blue-400/10 bg-[var(--status-cleaning-text)]/[0.025] p-4">
            <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--status-cleaning-text)]">
              Cleaning
            </div>

            <div className="mt-2 text-xl font-semibold text-[var(--status-cleaning-text)]">
              {
                fleetStats.cleaning
              }
            </div>
          </div>

          <div className="rounded-2xl border border-violet-400/10 bg-[var(--status-maintenance-text)]/[0.025] p-4">
            <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--status-maintenance-text)]">
              Maintenance
            </div>

            <div className="mt-2 text-xl font-semibold text-[var(--status-maintenance-text)]">
              {
                fleetStats.maintenance
              }
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted">
              Rentals
            </div>

            <div className="mt-2 text-xl font-semibold">
              {
                visibleSales.length
              }
            </div>
          </div>
        </div>

        {/* ====================================================
            VIEW SWITCHER
        ==================================================== */}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          <div className="flex w-fit rounded-xl border border-border bg-surface p-1">

            <button
              type="button"
              onClick={() =>
                setView(
                  "month"
                )
              }
              className={`flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-medium transition ${
                view ===
                "month"
                  ? "bg-surface-secondary text-text shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              <CalendarDays
                size={14}
              />
              Month
            </button>

            <button
              type="button"
              onClick={() =>
                setView(
                  "timeline"
                )
              }
              className={`flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-medium transition ${
                view ===
                "timeline"
                  ? "bg-surface-secondary text-text shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              <Clock3
                size={14}
              />
              Timeline
            </button>

            <button
              type="button"
              onClick={() =>
                setView(
                  "year"
                )
              }
              className={`flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-medium transition ${
                view ===
                "year"
                  ? "bg-surface-secondary text-text shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              <CalendarDays
                size={14}
              />
              Year
            </button>
          </div>

          <div className="flex gap-2" aria-label="Calendar event filters">
            {[["all", "All"], ["rentals", "Bookings"], ["todo", "To do"]].map(([value, label]) => <button key={value} onClick={() => setEventFilter(value)} aria-pressed={eventFilter === value} className={`rounded-lg border px-3 py-2 text-sm transition ${eventFilter === value ? "klynx-todo-selected" : "border-transparent text-text-secondary hover:bg-surface-secondary hover:text-text"}`}>{label}</button>)}
          </div>
          {activityError && <p role="alert" className="text-sm text-danger">{activityError}</p>}
          {/* LEGEND */}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm font-medium text-[var(--todo-text)]">● To do</span>
            <span className="text-sm text-text">● Quotation</span>

            <div className="flex items-center gap-1.5 text-[9px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-available-text)]" />
              Available
            </div>

            <div className="flex items-center gap-1.5 text-[9px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-rented-text)]" />
              Rented
            </div>

            <div className="flex items-center gap-1.5 text-[9px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-cleaning-text)]" />
              Cleaning
            </div>

            <div className="flex items-center gap-1.5 text-[9px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-maintenance-text)]" />
              Maintenance
            </div>

            <span className="rounded-full border border-red-400/20 bg-red-400/10 px-2 py-0.5 text-[7px] font-semibold uppercase tracking-wider text-red-400">
              Unavailable
            </span>
          </div>
        </div>

        {eventFilter !== "rentals" && view === "timeline" && <section className="mt-4 space-y-2 rounded-xl border border-[var(--todo-border)] bg-[var(--todo-bg-soft)] p-4">
          <h2 className="font-semibold text-[var(--todo-text)]">To do this month</h2>
          {activities.filter(item => item.date_deadline.startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`)).map(item => <Link key={item.id} href={activityHref(item)} className="block rounded-lg border border-[var(--todo-border)] bg-surface p-3 text-sm text-[var(--todo-text)] transition hover:bg-surface-secondary"><strong>{item.date_deadline} · {item.summary || "Follow up"} · {item.res_name}</strong><p className="mt-1 line-clamp-2">{noteText(item.note)}</p></Link>)}
        </section>}

        {/* ====================================================
            MONTH
        ==================================================== */}

        {view ===
          "month" && (
          <div className="mt-4">
            <MonthView
              month={
                month
              }
              sales={
                visibleSales
              }
              vehicleMap={
                vehicleMap
              }
              onRentalClick={(
                rental
              ) =>
                rental.activity ? router.push(activityHref(rental.activity)) : setSelectedRental(rental)
              }
            />
          </div>
        )}

        {/* ====================================================
            TIMELINE
        ==================================================== */}

        {view ===
          "timeline" && (
          <div className="mt-4">
            <TimelineView
              month={
                month
              }
              vehicles={
                visibleVehicles
              }
              sales={
                visibleSales
              }
              vehicleMap={
                vehicleMap
              }
              onRentalClick={(
                rental
              ) =>
                rental.activity ? router.push(activityHref(rental.activity)) : setSelectedRental(rental)
              }
            />
          </div>
        )}

        {/* ====================================================
            YEAR
        ==================================================== */}

        {view ===
          "year" && (
          <div className="mt-4">
            <YearView
              year={
                month.getFullYear()
              }
              sales={
                visibleSales
              }
              vehicles={
                visibleVehicles
              }
              vehicleMap={
                vehicleMap
              }
              onMonthClick={(
                monthIndex
              ) =>
                openYearMonth(
                  monthIndex
                )
              }
              onRentalClick={(
                rental
              ) =>
                rental.activity ? router.push(activityHref(rental.activity)) : setSelectedRental(rental)
              }
            />
          </div>
        )}

        {/* ====================================================
            FOOTER
        ==================================================== */}

        <div className="mt-4 flex items-center justify-between px-1 text-[9px] text-muted">
          <span>
            Live fleet & rental data
          </span>

          <span>
            Rental OS
          </span>
        </div>
      </div>

      {/* ======================================================
          RENTAL MODAL
      ====================================================== */}

      {selectedRental && (
        <RentalModal
          rental={
            selectedRental
          }
          vehicle={
            selectedRental.vehicle_id
              ? vehicleMap.get(
                  selectedRental.vehicle_id
                ) ||
                null
              : null
          }
          onClose={() =>
            setSelectedRental(
              null
            )
          }
        />
      )}
    </div>
  );
}
