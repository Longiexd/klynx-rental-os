"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Gauge,
  LayoutGrid,
  List,
  MapPin,
  Search,
  UserRound,
  Wrench,
  X,
} from "lucide-react";

import {
  getFleetStatus as classifyFleetStatus,
  fleetStatusMeta,
  toneClasses,
  type FleetStatus,
} from "@/lib/status";
import {
  formatDate as sharedFormatDate,
} from "@/lib/format";
import { SortableHeader, type SortDirection } from "@/components/ui/SortableHeader";
import { API_URL, apiRequest } from "@/lib/api-config";
import { getVehicleBookings } from "@/lib/fleet-bookings";
import { getRentalState, rentalStateMeta } from "@/lib/status";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import DocumentsPanel from "@/components/ui/DocumentsPanel";
import { VehicleAttentionBadge, VehicleCareNotice, FleetCareSummary, notifyFleetCareChanged } from "@/components/fleet/FleetCare";
import ReturnVehicleModal from "@/components/rentals/ReturnVehicleModal";
import type { NextVehicleState } from "@/lib/fleet-bookings";

// ============================================================
// TYPES
// ============================================================

type CarData = {
  id: number;
  name: string;
  license_plate: string | null;
  model: string | null;
  status: string | null;

  brand?: string | null;
  category?: string | null;
  location?: string | null;
  odometer?: number | null;
  odometer_unit?: string | null;
  active?: boolean;
};

type CarsResponse = {
  count: number;
  cars: CarData[];
};

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
  returned?: boolean;
  picked_up?: boolean;
  booking_status?: "quotation" | "confirmed" | "cancelled";
};

type SalesResponse = {
  count: number;
  sales: Sale[];
};

type SortKey =
  | "name"
  | "plate"
  | "model"
  | "status"
  | "rental"
  | "location"
  | "odometer";

// ============================================================
// CONFIG
// ============================================================

// ============================================================
// NORMALIZATION
// ============================================================

function normalize(
  value: string | null | undefined
) {
  return (
    value?.toLowerCase().trim() || ""
  );
}

// ============================================================
// ODOO FLEET STATE
//
// Classification and colors now live once in lib/status.ts —
// these are thin wrappers that keep this file's existing call
// signature (positional args, icon-augmented meta) so nothing
// below has to change, while the actual duplicated logic that
// used to live here is gone.
// ============================================================

function getFleetStatus(
  status: string | null,
  active?: boolean
): FleetStatus {
  return classifyFleetStatus({ status, active });
}

const STATUS_ICON: Record<FleetStatus, typeof Car> = {
  available: CheckCircle2,
  reserved: CalendarClock,
  rented: UserRound,
  returnDue: Clock3,
  cleaning: Car,
  maintenance: Wrench,
  unavailable: Clock3,
  inactive: Clock3,
  unknown: Car,
};

function getStatusMeta(
  fleetStatus: FleetStatus,
  originalStatus: string | null
) {
  const meta = fleetStatusMeta(fleetStatus);
  const classes = toneClasses(meta.tone);

  return {
    label: fleetStatus === "unknown" ? originalStatus || "Unknown" : meta.label,
    className: `${classes.border} ${classes.bg} ${classes.text}`,
    dot: classes.dot,
    icon: STATUS_ICON[fleetStatus],
  };
}

// ============================================================
// DATES
// ============================================================

function formatDate(value: string | null) {
  return sharedFormatDate(value);
}

// ============================================================
// RENTAL HELPERS
// ============================================================

// ============================================================
// STATUS BADGE
// ============================================================

function StatusBadge({
  car,
  compact = false,
}: {
  car: CarData;
  compact?: boolean;
}) {
  const fleetStatus =
    getFleetStatus(
      car.status,
      car.active
    );

  const meta =
    getStatusMeta(
      fleetStatus,
      car.status
    );

  const Icon = meta.icon;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border ${
        compact
          ? "px-2.5 py-1 text-[10px]"
          : "px-3 py-1.5 text-xs"
      } font-semibold ${meta.className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
      />

      {!compact && (
        <Icon size={11} />
      )}

      {meta.label}
    </span>
  );
}

// ============================================================
// VEHICLE CARD
// ============================================================

function VehicleCard({
  car,
  rental,
  quotations,
  onClick,
  onAction,
}: {
  car: CarData;
  rental: Sale | null;
  quotations: Sale[];
  onClick: () => void;
  onAction: (
    vehicleId: number,
    action: "return" | "mark-available" | "needs-diagnosis",
    nextState?: "Nettoyage" | "Disponible" | "Maintenance"
  ) => void;
}) {
  const fleetStatus =
    getFleetStatus(
      car.status,
      car.active
    );

  const [showReturnChoices, setShowReturnChoices] = useState(false);

  const needsReturn =
    fleetStatus === "rented" || fleetStatus === "returnDue";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") onClick();
      }}
      className="os-card group relative overflow-hidden rounded-xl border border-border bg-surface text-left transition duration-200 hover:border-strong"
    >
      <div
        className={`absolute inset-x-0 top-0 h-px ${
          fleetStatus ===
          "available"
            ? "bg-[var(--status-available-text)]/40"
            : fleetStatus ===
                "rented"
              ? "bg-[var(--status-rented-text)]/40"
              : fleetStatus ===
                  "cleaning"
                ? "bg-[var(--status-cleaning-text)]/40"
                : fleetStatus ===
                    "maintenance"
                  ? "bg-[var(--status-maintenance-text)]/40"
                  : "bg-transparent"
        }`}
      />

      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-secondary">
              <Car
                size={20}
                className="text-text-secondary transition group-hover:text-text"
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1 text-sm font-semibold text-text">
                <span className="truncate">{car.model || car.name}</span>
                <VehicleAttentionBadge vehicleId={car.id} />
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                <span>
                  {car.name}
                </span>

                {car.license_plate && (
                  <>
                    <span>
                      •
                    </span>

                    <span className="font-mono">
                      {
                        car.license_plate
                      }
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <ChevronRight
            size={16}
            className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-text-secondary"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusBadge car={car} />
        </div>

        {rental && ["rented", "reserved", "returnDue"].includes(fleetStatus) && (
            <div className="mt-4 rounded-lg bg-surface-secondary p-3.5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted">
                <UserRound size={12} />
                {fleetStatus === "reserved" ? "Reserved for" : "Rented to"}
              </div>

              <div className="mt-2 truncate text-sm font-medium text-text">
                {rental.customer
                  ?.name ||
                  "Customer"}
              </div>

              <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                <CalendarDays size={12} />

                <span>
                  {formatDate(
                    rental.date_order
                  )}
                </span>

                <span>
                  →
                </span>

                <span>
                  {formatDate(
                    rental.commitment_date
                  )}
                </span>
              </div>
            </div>
          )}

        {quotations.length > 0 && (
          <div className="mt-4 rounded-lg bg-surface-secondary p-3.5">
            <p className="text-xs font-medium text-text-secondary">Quotations · do not reserve the vehicle</p>
            <div className="mt-2 max-h-32 space-y-2 overflow-y-auto">
              {quotations.map(quotation => (
                <Link key={quotation.id} href={`/dashboard/rentals/${quotation.id}`}
                  onClick={event => event.stopPropagation()}
                  className="block rounded-lg p-2 text-sm text-text hover:bg-background focus-visible:outline-lime-ink">
                  <span className="block truncate font-medium">{quotation.customer?.name || quotation.name}</span>
                  <span className="text-xs text-muted">{formatDate(quotation.date_order)} → {formatDate(quotation.commitment_date)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {fleetStatus ===
          "cleaning" && (
          <div className="mt-5 rounded-xl border border-blue-400/10 bg-[var(--status-cleaning-text)]/[0.04] p-3.5">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--status-cleaning-text)]/70">
              Operational state
            </div>

            <div className="mt-1 text-sm font-medium text-text">
              En nettoyage
            </div>
          </div>
        )}

        {fleetStatus ===
          "maintenance" && (
          <div className="mt-5 rounded-xl border border-violet-400/10 bg-[var(--status-maintenance-text)]/[0.04] p-3.5">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--status-maintenance-text)]/70">
              Operational state
            </div>

            <div className="mt-1 text-sm font-medium text-text">
              Maintenance
            </div>
          </div>
        )}

        {fleetStatus ===
          "available" && (
          <div className="mt-4 rounded-lg bg-surface-secondary p-3.5">
            <div className="text-xs text-muted">
              No active rental
            </div>

            <div className="mt-1 text-sm text-text-secondary">
              Ready for operations
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 text-xs">
          <div className="flex min-w-0 items-center gap-2 text-muted">
            <MapPin size={12} />

            <span className="truncate">
              {car.location ||
                "No location"}
            </span>
          </div>

          {car.odometer !=
            null && (
            <div className="flex shrink-0 items-center gap-1.5 text-muted">
              <Gauge size={12} />

              <span>
                {car.odometer.toLocaleString()}{" "}
                {car.odometer_unit ||
                  "km"}
              </span>
            </div>
          )}
        </div>
        {(needsReturn ||
          fleetStatus === "cleaning" ||
          (fleetStatus === "maintenance" || fleetStatus === "unavailable")) && (
          <div
            className="mt-4"
            onClick={(event) => event.stopPropagation()}
          >
            {needsReturn && !showReturnChoices && (
              <button
                type="button"
                onClick={() => setShowReturnChoices(true)}
                className={`w-full rounded-lg border py-2 text-xs font-medium transition ${
                  fleetStatus === "returnDue"
                    ? "border-danger/30 bg-danger/10 text-danger hover:bg-danger/20"
                    : "border-border bg-surface-secondary text-text hover:bg-surface-secondary"
                }`}
              >
                {fleetStatus === "returnDue"
                  ? "Confirm return — overdue"
                  : "Mark as returned"}
              </button>
            )}

            {needsReturn && showReturnChoices && (
              <div className="space-y-1.5">
                <div className="mb-1 text-[10px] text-muted">
                  Send vehicle to:
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onAction(car.id, "return", "Nettoyage")
                    }
                    className="rounded-lg border border-blue-400/30 bg-[var(--status-cleaning-text)]/10 py-1.5 text-[11px] font-medium text-[var(--status-cleaning-text)] transition hover:bg-[var(--status-cleaning-text)]/20"
                  >
                    Cleaning
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onAction(car.id, "return", "Disponible")
                    }
                    className="rounded-lg border border-[#C8F065]/30 bg-[var(--status-available-text)]/10 py-1.5 text-[11px] font-medium text-[var(--status-available-text)] transition hover:bg-[var(--status-available-text)]/20"
                  >
                    Available
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onAction(car.id, "return", "Maintenance")
                    }
                    className="rounded-lg border border-violet-400/30 bg-[var(--status-maintenance-text)]/10 py-1.5 text-[11px] font-medium text-[var(--status-maintenance-text)] transition hover:bg-[var(--status-maintenance-text)]/20"
                  >
                    Maintenance
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowReturnChoices(false)}
                  className="w-full py-1 text-[10px] text-muted hover:text-text-secondary"
                >
                  Cancel
                </button>
              </div>
            )}

            {!needsReturn &&
              (fleetStatus === "cleaning" ||
                (fleetStatus === "maintenance" || fleetStatus === "unavailable")) && (
                <button
                  type="button"
                  onClick={() =>
                    onAction(car.id, "mark-available")
                  }
                  className="w-full rounded-lg border border-[#C8F065]/30 bg-[var(--status-available-text)]/10 py-2 text-xs font-medium text-[var(--status-available-text)] transition hover:bg-[var(--status-available-text)]/20"
                >
                  Mark as available
                </button>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// VEHICLE MODAL
// ============================================================

function VehicleModal({
  car,
  rental,
  onClose,
  onAction,
}: {
  car: CarData;
  rental: Sale | null;
  onClose: () => void;
  onAction: (
    vehicleId: number,
    action: "return" | "mark-available" | "needs-diagnosis",
    nextState?: "Nettoyage" | "Disponible" | "Maintenance"
  ) => void;
}) {
  const features = useFeatures();
  const fleetStatus =
    getFleetStatus(
      car.status,
      car.active
    );

  const meta =
    getStatusMeta(
      fleetStatus,
      car.status
    );

  const Icon = meta.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close vehicle details"
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-md"
      />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl shadow-black/50">
        {/* HEADER */}

        <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-secondary">
              <Car
                size={18}
                className="text-text"
              />
            </div>

            <div>
              <div className="text-sm font-semibold text-text">
                Vehicle details
              </div>

              <div className="mt-0.5 text-xs text-muted">
                Vehicle #
                {car.id}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-secondary hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        {/* CONTENT */}

        <div className="overflow-y-auto p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
                Vehicle
              </div>

              <h2 className="mt-2 font-[Syne] text-2xl font-semibold tracking-tight text-text">
                {car.model ||
                  car.name}
              </h2>

              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>
                  {car.name}
                </span>

                {car.license_plate && (
                  <>
                    <span>
                      •
                    </span>

                    <span className="font-mono">
                      {
                        car.license_plate
                      }
                    </span>
                  </>
                )}
              </div>
            </div>

            <StatusBadge car={car} />
          </div>

          {/* AVAILABILITY */}

          <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${meta.className}`}
              >
                <Icon size={18} />
              </div>

              <div className="min-w-0">
                <div className="text-xs text-muted">
                  Current status
                </div>

                <div className="mt-1 text-base font-semibold text-text">
                  {meta.label}
                </div>

                {car.status && (
                  <div className="mt-1 text-xs text-muted">
                    Status:{" "}
                    <span className="text-text-secondary">
                      {car.status}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {fleetStatus ===
              "rented" &&
            rental ? (
              <div className="mt-5 border-t border-border pt-5">
                <div className="mb-4 text-[10px] uppercase tracking-[0.12em] text-muted">
                  Current rental
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted">
                      Customer
                    </div>

                    {rental.customer ? (
                      <Link
                        href={`/dashboard/customers/${rental.customer.id}`}
                        onClick={onClose}
                        className="mt-2 flex items-center gap-2 text-sm font-medium text-text transition hover:text-[var(--status-available-text)]"
                      >
                        <UserRound
                          size={14}
                          className="text-[var(--status-rented-text)]"
                        />

                        <span className="truncate">
                          {
                            rental
                              .customer
                              .name
                          }
                        </span>
                      </Link>
                    ) : (
                      <div className="mt-2 text-sm text-muted">
                        No customer
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted">
                      Pickup
                    </div>

                    <div className="mt-2 flex items-center gap-2 text-sm font-medium text-text">
                      <CalendarDays
                        size={14}
                        className="text-muted"
                      />

                      {formatDate(
                        rental.date_order
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted">
                      Return
                    </div>

                    <div className="mt-2 flex items-center gap-2 text-sm font-medium text-text">
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

                <div className="mt-5 rounded-xl border border-border bg-surface-secondary p-4">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted">
                    Rental order
                  </div>

                  <div className="mt-1 font-mono text-sm font-medium text-text">
                    {rental.name}
                  </div>
                </div>
              </div>
            ) : fleetStatus ===
              "cleaning" ? (
              <div className="mt-5 border-t border-border pt-5">
                <div className="rounded-xl border border-blue-400/10 bg-[var(--status-cleaning-text)]/[0.04] p-4">
                  <div className="text-sm font-medium text-text">
                    En nettoyage
                  </div>

                  <div className="mt-1 text-xs leading-5 text-muted">
                    This vehicle is currently being prepared and should not be assigned to a new rental.
                  </div>
                </div>
              </div>
            ) : fleetStatus ===
              "maintenance" ? (
              <div className="mt-5 border-t border-border pt-5">
                <div className="rounded-xl border border-violet-400/10 bg-[var(--status-maintenance-text)]/[0.04] p-4">
                  <div className="text-sm font-medium text-text">
                    Maintenance
                  </div>

                  <div className="mt-1 text-xs leading-5 text-muted">
                    This vehicle is currently unavailable for rental operations.
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 border-t border-border pt-5">
                <div className="text-sm font-medium text-text">
                  No active rental
                </div>

                <div className="mt-1 text-xs text-muted">
                  No rental currently associated with this vehicle.
                </div>
              </div>
            )}
          </div>

          {/* LINKS */}

          {rental && <div className="mt-4 rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-medium text-text">{rentalStateMeta(getRentalState(rental)).label}</p>
            <Link href={`/dashboard/rentals/${rental.id}#handover`} onClick={onClose}
              className="mt-3 inline-block rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-black">
              {!rental.picked_up ? "Open booking / confirm pickup" : "Open booking / return"}
            </Link>
          </div>}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {rental?.customer && (
              <Link
                href={`/dashboard/customers/${rental.customer.id}`}
                onClick={onClose}
                className="flex h-11 items-center justify-between rounded-xl border border-border bg-surface-secondary px-4 text-xs font-medium text-text transition hover:border-strong hover:bg-surface-secondary hover:text-text"
              >
                <span className="flex items-center gap-2">
                  <UserRound size={14} />
                  View customer
                </span>

                <ArrowRight size={14} />
              </Link>
            )}

            <Link
              href={`/dashboard/calendar?vehicle=${car.id}`}
              onClick={onClose}
              className="flex h-11 items-center justify-between rounded-xl bg-lime px-4 text-xs font-semibold text-black transition hover:bg-[#d7ff80]"
            >
              <span className="flex items-center gap-2">
                <CalendarDays size={14} />
                View rental calendar
              </span>

              <ArrowRight size={14} />
            </Link>
          </div>

          <VehicleCareNotice vehicleId={car.id} />
          {features?.fleet_care && <details key={`vehicle-documents-${car.id}`} className="mt-6 rounded-xl border border-border bg-surface p-4">
            <summary className="cursor-pointer text-sm font-semibold text-text">
              Vehicle documents
              <span className="ml-2 font-normal text-text-secondary">Assurance · Carte grise · Visite technique</span>
            </summary>
            <DocumentsPanel key={car.id} owner="cars" recordId={car.id} onChanged={notifyFleetCareChanged} />
          </details>}

          {/* VEHICLE INFORMATION */}

          <div className="mt-6">
            <div className="mb-3 text-[10px] uppercase tracking-[0.14em] text-muted">
              Vehicle information
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              {[
                [
                  "Vehicle",
                  car.name,
                ],
                [
                  "Model",
                  car.model ||
                    "—",
                ],
                [
                  "Brand",
                  car.brand ||
                    "—",
                ],
                [
                  "Category",
                  car.category ||
                    "—",
                ],
                [
                  "License plate",
                  car.license_plate ||
                    "—",
                ],
                [
                  "Location",
                  car.location ||
                    "—",
                ],
                [
                  "Odometer",
                  car.odometer !=
                  null
                    ? `${car.odometer.toLocaleString()} ${
                        car.odometer_unit ||
                        "km"
                      }`
                    : "—",
                ],
                [
                  "Fleet ID",
                  `#${car.id}`,
                ],
              ].map(
                (
                  [label, value],
                  index
                ) => (
                  <div
                    key={label}
                    className={`flex items-center justify-between gap-5 px-5 py-3.5 ${
                      index <
                      7
                        ? "border-b border-border"
                        : ""
                    }`}
                  >
                    <span className="text-xs text-muted">
                      {label}
                    </span>

                    <span className="text-right text-sm text-text">
                      {value}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* ACTIONS */}

        {(fleetStatus === "rented" ||
          fleetStatus === "returnDue" ||
          fleetStatus === "cleaning" ||
          (fleetStatus === "maintenance" || fleetStatus === "unavailable")) && (
          <div className="border-t border-border bg-background px-5 py-4 sm:px-6">
            {(fleetStatus === "rented" ||
              fleetStatus === "returnDue") && (
              <>
                <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted">
                  Confirm return — send to:
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onAction(car.id, "return", "Nettoyage")
                    }
                    className="flex-1 rounded-lg border border-blue-400/30 bg-[var(--status-cleaning-text)]/10 py-2 text-xs font-medium text-[var(--status-cleaning-text)] transition hover:bg-[var(--status-cleaning-text)]/20"
                  >
                    Cleaning
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onAction(car.id, "return", "Disponible")
                    }
                    className="flex-1 rounded-lg border border-[#C8F065]/30 bg-[var(--status-available-text)]/10 py-2 text-xs font-medium text-[var(--status-available-text)] transition hover:bg-[var(--status-available-text)]/20"
                  >
                    Available
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onAction(car.id, "return", "Maintenance")
                    }
                    className="flex-1 rounded-lg border border-violet-400/30 bg-[var(--status-maintenance-text)]/10 py-2 text-xs font-medium text-[var(--status-maintenance-text)] transition hover:bg-[var(--status-maintenance-text)]/20"
                  >
                    Maintenance
                  </button>
                </div>
              </>
            )}

            {fleetStatus === "cleaning" && (
              <>
                <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted">
                  Cleaning status
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onAction(car.id, "mark-available")
                    }
                    className="flex-1 rounded-lg border border-[#C8F065]/30 bg-[var(--status-available-text)]/10 py-2 text-xs font-medium text-[var(--status-available-text)] transition hover:bg-[var(--status-available-text)]/20"
                  >
                    Cleaning finished — Available
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onAction(
                        car.id,
                        "needs-diagnosis"
                      )
                    }
                    className="flex-1 rounded-lg border border-violet-400/30 bg-[var(--status-maintenance-text)]/10 py-2 text-xs font-medium text-[var(--status-maintenance-text)] transition hover:bg-[var(--status-maintenance-text)]/20"
                  >
                    Needs diagnosis — Maintenance
                  </button>
                </div>
              </>
            )}

            {(fleetStatus === "maintenance" || fleetStatus === "unavailable") && (
              <button
                type="button"
                onClick={() => onAction(car.id, "mark-available")}
                className="w-full rounded-lg border border-[#C8F065]/30 bg-[var(--status-available-text)]/10 py-2 text-xs font-medium text-[var(--status-available-text)] transition hover:bg-[var(--status-available-text)]/20"
              >
                Checks finished — mark Available
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SORT ICON
// ============================================================

// ============================================================
// TABLE (uses the shared SortableHeader from components/ui)
// ============================================================


// ============================================================
// PAGE
// ============================================================

export default function FleetPage() {
  return <Suspense fallback={<p className="p-5 text-muted">Loading vehicles…</p>}><FleetContent /></Suspense>;
}

function FleetContent() {
  const query = useSearchParams();
  const router = useRouter();
  const [cars, setCars] =
    useState<CarData[]>([]);

  const [sales, setSales] =
    useState<Sale[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState<FleetStatus | null>(null);

  // Cards expose booking context and operational actions immediately.
  const [view, setView] =
    useState<"list" | "cards">(
      "cards"
    );

  const [selectedCar, setSelectedCar] =
    useState<CarData | null>(
      null
    );
  const [returningVehicle, setReturningVehicle] = useState<{
    id: number; nextState: NextVehicleState;
  } | null>(null);

  const [sortKey, setSortKey] =
    useState<SortKey>("name");

  const [sortDirection, setSortDirection] =
    useState<SortDirection>("asc");

  // ==========================================================
  // FETCH
  // ==========================================================

  async function loadFleet() {
      try {
        setLoading(true);
        setError(null);

        // Recompute Reserved/Louee/Retour du against today's
        // date before fetching — without this, a vehicle's
        // state only ever updates at the moment a rental is
        // created, and silently goes stale as days pass.
        try {
          await apiRequest(`${API_URL}/cars/sync`, { method: "POST" });
        } catch (syncError) {
          console.error("Fleet state sync failed:", syncError);
        }

        const [
          carsResponse,
          salesResponse,
        ] = await Promise.all([
          apiRequest(`${API_URL}/cars`, {
            cache: "no-store",
          }),
          apiRequest(`${API_URL}/sales?for_fleet=true`, {
            cache: "no-store",
          }),
        ]);

        if (!carsResponse.ok) {
          throw new Error(
            `Cars API returned ${carsResponse.status}`
          );
        }

        if (!salesResponse.ok) {
          throw new Error(
            `Sales API returned ${salesResponse.status}`
          );
        }

        const carsData: CarsResponse =
          await carsResponse.json();

        const salesData: SalesResponse =
          await salesResponse.json();

        setCars(
          carsData.cars || []
        );

        setSales(
          salesData.sales || []
        );
      } catch (err) {
        console.error(err);

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load fleet data."
        );
      } finally {
        setLoading(false);
      }
  }

  useEffect(() => {
    void loadFleet();
  }, []);

  // ==========================================================
  // FLEET STATE ACTIONS
  // "Confirm return" / "Mark as available" — reachable from
  // both vehicle cards and KPI results per the same action set.
  // ==========================================================

  async function handleVehicleAction(
    vehicleId: number,
    action: "return" | "mark-available" | "needs-diagnosis",
    nextState?: "Nettoyage" | "Disponible" | "Maintenance"
  ) {
    if (action === "return") {
      setSelectedCar(null);
      setReturningVehicle({ id: vehicleId, nextState: nextState || "Nettoyage" });
      return;
    }
    try {
      const response = await apiRequest(
        `${API_URL}/cars/${vehicleId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.detail || `API returned ${response.status}`
        );
      }

      await loadFleet();
      notifyFleetCareChanged();
    } catch (err) {
      console.error(
        `Failed to ${action} vehicle ${vehicleId}:`,
        err
      );
      setError(
        err instanceof Error
          ? err.message
          : `Unable to update this vehicle.`
      );
    }
  }

  // ==========================================================
  // FLEET VIEW MODEL
  // ==========================================================

  const fleet = useMemo(() => {
    const bookingsByVehicle = new Map<number, Sale[]>();
    for (const sale of sales) {
      if (sale.vehicle_id) {
        const bookings = bookingsByVehicle.get(sale.vehicle_id) || [];
        bookings.push(sale);
        bookingsByVehicle.set(sale.vehicle_id, bookings);
      }
    }
    return cars.map((car) => ({
      car,
      status: getFleetStatus(
        car.status,
        car.active
      ),
      ...getVehicleBookings(car.id, bookingsByVehicle.get(car.id) || []),
    }));
  }, [cars, sales]);

  // ==========================================================
  // SEARCH
  // ==========================================================

  const searchedFleet =
    useMemo(() => {
      const query =
        search.toLowerCase().trim();

      return fleet.filter(
        ({ car, status, rental }) => {
          if (
            statusFilter &&
            status !== statusFilter
          ) {
            return false;
          }

          if (!query) return true;

          const label =
            getStatusMeta(
              getFleetStatus(
                car.status,
                car.active
              ),
              car.status
            ).label;

          return [
            car.name,
            car.license_plate,
            car.model,
            car.brand,
            car.category,
            car.location,
            car.status,
            label,
            rental?.name,
            rental?.customer?.name,
          ]
            .filter(Boolean)
            .some((value) =>
              value!
                .toLowerCase()
                .includes(query)
            );
        }
      );
    }, [fleet, search, statusFilter]);

  // ==========================================================
  // SORT
  // ==========================================================

  const filteredFleet =
    useMemo(() => {
      const result = [
        ...searchedFleet,
      ];

      result.sort((a, b) => {
        let aValue = "";
        let bValue = "";

        switch (sortKey) {
          case "name":
            aValue = normalize(
              a.car.name
            );
            bValue = normalize(
              b.car.name
            );
            break;

          case "plate":
            aValue = normalize(
              a.car.license_plate
            );
            bValue = normalize(
              b.car.license_plate
            );
            break;

          case "model":
            aValue = normalize(
              a.car.model
            );
            bValue = normalize(
              b.car.model
            );
            break;

          case "status":
            aValue = normalize(
              getStatusMeta(
                a.status,
                a.car.status
              ).label
            );

            bValue = normalize(
              getStatusMeta(
                b.status,
                b.car.status
              ).label
            );
            break;

          case "rental":
            aValue = normalize(
              a.rental
                ?.customer?.name ||
                ""
            );

            bValue = normalize(
              b.rental
                ?.customer?.name ||
                ""
            );
            break;

          case "location":
            aValue = normalize(
              a.car.location
            );

            bValue = normalize(
              b.car.location
            );
            break;

          case "odometer":
            return (
              ((a.car.odometer ||
                0) -
                (b.car.odometer ||
                  0)) *
              (sortDirection ===
              "asc"
                ? 1
                : -1)
            );
        }

        const comparison =
          aValue.localeCompare(
            bValue,
            undefined,
            {
              numeric: true,
              sensitivity:
                "base",
            }
          );

        return (
          comparison *
          (sortDirection ===
          "asc"
            ? 1
            : -1)
        );
      });

      return result;
    }, [
      searchedFleet,
      sortKey,
      sortDirection,
    ]);

  // ==========================================================
  // SORT HANDLER
  // ==========================================================

  function handleSort(
    key: SortKey
  ) {
    if (sortKey === key) {
      setSortDirection(
        (current) =>
          current === "asc"
            ? "desc"
            : "asc"
      );

      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  }

  // ==========================================================
  // COUNTS
  // ==========================================================

  const counts = useMemo(() => {
    return {
      total: fleet.length,

      available:
        fleet.filter(
          (item) =>
            item.status ===
            "available"
        ).length,

      reserved:
        fleet.filter(
          (item) => item.status === "reserved"
        ).length,

      rented:
        fleet.filter(
          (item) =>
            item.status ===
            "rented"
        ).length,

      returnDue:
        fleet.filter(
          (item) => item.status === "returnDue"
        ).length,

      cleaning:
        fleet.filter(
          (item) =>
            item.status ===
            "cleaning"
        ).length,

      maintenance:
        fleet.filter(
          (item) =>
            item.status ===
            "maintenance"
        ).length,
    };
  }, [fleet]);

  // ==========================================================
  // SELECTED
  // ==========================================================

  const requestedCar = cars.find(car => String(car.id) === query.get("vehicle")) || selectedCar;
  const selectedDetails =
    requestedCar
      ? fleet.find(
          (item) =>
            item.car.id ===
            requestedCar.id
        )
      : null;

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <>
      <main className="mx-auto max-w-[1500px] p-5 sm:p-8">
        {/* HEADER */}

        <section className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
              <span>
                Workspace
              </span>

              <span>/</span>

              <span className="text-text-secondary">
                Vehicles
              </span>
            </div>

            <h1 className="font-[Syne] text-[28px] font-semibold tracking-[-0.035em] text-text sm:text-[32px]">
              Vehicles
            </h1>

            <p className="mt-1 text-sm text-muted">
              Vehicle availability and operational status.
            </p>
          </div>

          {/* VIEW SWITCHER */}

          <div className="flex h-9 items-center rounded-lg border border-border bg-surface p-1">
            <button
              type="button"
              onClick={() =>
                setView("list")
              }
              className={`flex h-7 items-center gap-2 rounded-md px-3 text-xs font-medium transition ${
                view === "list"
                  ? "bg-surface-secondary text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              <List size={13} />
              List
            </button>

            <button
              type="button"
              onClick={() =>
                setView("cards")
              }
              className={`flex h-7 items-center gap-2 rounded-md px-3 text-xs font-medium transition ${
                view === "cards"
                  ? "bg-surface-secondary text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              <LayoutGrid
                size={13}
              />
              Cards
            </button>
          </div>
        </section>

        {/* KPI */}

        <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <button
            type="button"
            onClick={() => setStatusFilter(null)}
            className={`rounded-2xl border p-5 text-left transition ${
              statusFilter === null
                ? "border-border bg-surface-secondary"
                : "border-border bg-surface hover:bg-surface-secondary"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                Total Fleet
              </span>

              <Car
                size={16}
                className="text-muted"
              />
            </div>

            <div className="mt-3 text-3xl font-semibold text-text">
              {loading
                ? "—"
                : counts.total}
            </div>

            <div className="mt-1 text-xs text-muted">
              {statusFilter
                ? "clear filter"
                : "vehicles"}
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(
                statusFilter === "available"
                  ? null
                  : "available"
              )
            }
            className={`rounded-2xl border p-5 text-left transition ${
              statusFilter === "available"
                ? "border-[#C8F065]/60 bg-[var(--status-available-text)]/10"
                : "border-[var(--status-available-border)] bg-[var(--status-available-text)]/[0.04] hover:bg-[var(--status-available-text)]/10"
            }`}
          >
            <span className="text-xs text-[var(--status-available-text)]">
              Available
            </span>

            <div className="mt-3 text-3xl font-semibold text-text">
              {loading
                ? "—"
                : counts.available}
            </div>

            <div className="mt-1 text-xs text-[var(--status-available-text)]">
              ready to rent
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(
                statusFilter === "reserved"
                  ? null
                  : "reserved"
              )
            }
            className={`rounded-2xl border p-5 text-left transition ${
              statusFilter === "reserved"
                ? "border-amber-400/60 bg-[var(--status-reserved-text)]/10"
                : "border-[var(--status-reserved-border)] bg-[var(--status-reserved-text)]/[0.04] hover:bg-[var(--status-reserved-text)]/10"
            }`}
          >
            <span className="text-xs text-[var(--status-reserved-text)]">
              Reserved
            </span>

            <div className="mt-3 text-3xl font-semibold text-text">
              {loading
                ? "—"
                : counts.reserved}
            </div>

            <div className="mt-1 text-xs text-[var(--status-reserved-text)]">
              booked, not yet picked up
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(
                statusFilter === "rented"
                  ? null
                  : "rented"
              )
            }
            className={`rounded-2xl border p-5 text-left transition ${
              statusFilter === "rented"
                ? "border-[#F06AAA]/60 bg-[var(--status-rented-text)]/10"
                : "border-[var(--status-rented-border)] bg-[var(--status-rented-text)]/[0.04] hover:bg-[var(--status-rented-text)]/10"
            }`}
          >
            <span className="text-xs text-[var(--status-rented-text)]">
              Rented
            </span>

            <div className="mt-3 text-3xl font-semibold text-text">
              {loading
                ? "—"
                : counts.rented}
            </div>

            <div className="mt-1 text-xs text-[var(--status-rented-text)]">
              currently rented
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(
                statusFilter === "cleaning"
                  ? null
                  : "cleaning"
              )
            }
            className={`rounded-2xl border p-5 text-left transition ${
              statusFilter === "cleaning"
                ? "border-blue-400/60 bg-[var(--status-cleaning-text)]/10"
                : "border-[var(--status-cleaning-border)] bg-[var(--status-cleaning-text)]/[0.04] hover:bg-[var(--status-cleaning-text)]/10"
            }`}
          >
            <span className="text-xs text-[var(--status-cleaning-text)]">
              Cleaning
            </span>

            <div className="mt-3 text-3xl font-semibold text-text">
              {loading
                ? "—"
                : counts.cleaning}
            </div>

            <div className="mt-1 text-xs text-[var(--status-cleaning-text)]">
              being prepared
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(
                statusFilter === "maintenance"
                  ? null
                  : "maintenance"
              )
            }
            className={`rounded-2xl border p-5 text-left transition ${
              statusFilter === "maintenance"
                ? "border-violet-400/60 bg-[var(--status-maintenance-text)]/10"
                : "border-[var(--status-maintenance-border)] bg-[var(--status-maintenance-text)]/[0.04] hover:bg-[var(--status-maintenance-text)]/10"
            }`}
          >
            <span className="text-xs text-[var(--status-maintenance-text)]">
              Maintenance
            </span>

            <div className="mt-3 text-3xl font-semibold text-text">
              {loading
                ? "—"
                : counts.maintenance}
            </div>

            <div className="mt-1 text-xs text-[var(--status-maintenance-text)]">
              unavailable
            </div>
          </button>
        </section>

        {/* SEARCH */}

        <section className="mt-5">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />

            <input
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              placeholder="Search vehicles, plates, models, status, customers..."
              className="h-10 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-sm text-text outline-none placeholder:text-muted focus:border-[#C8F065]/50"
            />
          </div>
        </section>

        {/* ERROR */}

        {error && (
          <div className="mt-4 rounded-xl border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* RESULTS */}

        <section className="mt-5">
          {loading ? (
            <div className="rounded-2xl border border-border bg-surface px-5 py-14 text-center text-sm text-muted">
              Loading vehicles...
            </div>
          ) : filteredFleet.length ===
            0 ? (
            <div className="rounded-2xl border border-border bg-surface px-5 py-16 text-center">
              <Car
                size={24}
                className="mx-auto text-muted"
              />

              <div className="mt-4 text-sm text-text-secondary">
                No vehicles found.
              </div>
            </div>
          ) : view ===
            "list" ? (
            /* =================================================
               LIST VIEW
            ================================================= */

            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[950px]">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <SortableHeader
                        label="Vehicle"
                        sortKey="name"
                        currentKey={
                          sortKey
                        }
                        direction={
                          sortDirection
                        }
                        onSort={
                          handleSort
                        }
                      />

                      <SortableHeader
                        label="Plate"
                        sortKey="plate"
                        currentKey={
                          sortKey
                        }
                        direction={
                          sortDirection
                        }
                        onSort={
                          handleSort
                        }
                      />

                      <SortableHeader
                        label="Model"
                        sortKey="model"
                        currentKey={
                          sortKey
                        }
                        direction={
                          sortDirection
                        }
                        onSort={
                          handleSort
                        }
                      />

                      <SortableHeader
                        label="Status"
                        sortKey="status"
                        currentKey={
                          sortKey
                        }
                        direction={
                          sortDirection
                        }
                        onSort={
                          handleSort
                        }
                      />

                      <SortableHeader
                        label="Rental"
                        sortKey="rental"
                        currentKey={
                          sortKey
                        }
                        direction={
                          sortDirection
                        }
                        onSort={
                          handleSort
                        }
                      />

                      <SortableHeader
                        label="Location"
                        sortKey="location"
                        currentKey={
                          sortKey
                        }
                        direction={
                          sortDirection
                        }
                        onSort={
                          handleSort
                        }
                      />

                      <SortableHeader
                        label="ID"
                        sortKey="name"
                        currentKey={
                          sortKey
                        }
                        direction={
                          sortDirection
                        }
                        onSort={
                          handleSort
                        }
                        align="right"
                      />
                    </tr>
                  </thead>

                  <tbody>
                    {filteredFleet.map(
                      ({
                        car,
                        rental,
                      }) => (
                        <tr
                          key={car.id}
                          onClick={() =>
                            setSelectedCar(
                              car
                            )
                          }
                          className="cursor-pointer border-b border-border transition last:border-0 hover:bg-surface-secondary"
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-secondary">
                                <Car
                                  size={15}
                                  className="text-text-secondary"
                                />
                              </div>

                              <div>
                                <div className="font-medium text-text">
                                  {car.model ||
                                    car.name}
                                  <VehicleAttentionBadge vehicleId={car.id} />
                                </div>

                                <div className="mt-0.5 text-xs text-muted">
                                  {car.name}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-5 py-4 font-mono text-xs text-text-secondary">
                            {car.license_plate ||
                              "—"}
                          </td>

                          <td className="px-5 py-4 text-sm text-text-secondary">
                            {car.model ||
                              "—"}
                          </td>

                          <td className="px-5 py-4">
                            <StatusBadge
                              car={car}
                              compact
                            />
                          </td>

                          <td className="px-5 py-4">
                            {rental &&
                            getFleetStatus(
                              car.status,
                              car.active
                            ) ===
                              "rented" ? (
                              <div>
                                <div className="text-xs font-medium text-text">
                                  {rental
                                    .customer
                                    ?.name ||
                                    "Customer"}
                                </div>

                                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted">
                                  <span>
                                    {formatDate(
                                      rental.date_order
                                    )}
                                  </span>

                                  <span>
                                    →
                                  </span>

                                  <span>
                                    {formatDate(
                                      rental.commitment_date
                                    )}
                                  </span>
                                </div>
                              </div>
                            ) : getFleetStatus(
                                car.status,
                                car.active
                              ) ===
                              "cleaning" ? (
                              <span className="text-xs text-[var(--status-cleaning-text)]">
                                En nettoyage
                              </span>
                            ) : getFleetStatus(
                                car.status,
                                car.active
                              ) ===
                              "maintenance" ? (
                              <span className="text-xs text-[var(--status-maintenance-text)]">
                                Maintenance
                              </span>
                            ) : (
                              <span className="text-xs text-muted">
                                —
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-4 text-xs text-muted">
                            {car.location ||
                              "—"}
                          </td>

                          <td className="px-5 py-4 text-right font-mono text-xs text-muted">
                            #{car.id}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* =================================================
               CARD VIEW
            ================================================= */

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredFleet.map(
                ({
                  car,
                  rental,
                  quotations,
                }) => (
                  <VehicleCard
                    key={car.id}
                    car={car}
                    rental={rental}
                    quotations={quotations}
                    onClick={() =>
                      setSelectedCar(
                        car
                      )
                    }
                    onAction={handleVehicleAction}
                  />
                )
              )}
            </div>
          )}
        </section>
        <FleetCareSummary />
      </main>

      {/* MODAL */}

      {returningVehicle && <ReturnVehicleModal vehicleId={returningVehicle.id}
        initialNextState={returningVehicle.nextState} onClose={() => setReturningVehicle(null)}
        onReturned={async () => { await loadFleet(); setReturningVehicle(null); }} />}

      {selectedDetails && (
        <VehicleModal
          car={
            selectedDetails.car
          }
          rental={
            selectedDetails.rental
          }
          onClose={() => {
            setSelectedCar(null);
            if (query.has("vehicle")) router.replace("/dashboard/fleet", {scroll: false});
          }}
          onAction={handleVehicleAction}
        />
      )}
    </>
  );
}
