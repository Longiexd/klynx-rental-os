"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Loader2,
  Mail,
  Phone,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { API_URL, apiRequest } from "@/lib/api-config";

type AddLeadModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

type CustomerMatch = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  is_customer: boolean;
};

type VehicleOption = {
  id: number;
  name: string;
};

type LeadOptions = {
  vehicle_types: VehicleOption[];
  vehicle_brands: VehicleOption[];
};

export default function AddLeadModal({
  open,
  onClose,
  onCreated,
}: AddLeadModalProps) {
  // ============================================================
  // BASIC LEAD INFORMATION
  // ============================================================

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");

  // ============================================================
  // RESERVATION REQUIREMENTS
  // ============================================================

  const [reservationStart, setReservationStart] = useState("");
  const [reservationEnd, setReservationEnd] = useState("");

  const [vehicleTypes, setVehicleTypes] = useState<VehicleOption[]>(
    []
  );

  const [vehicleBrands, setVehicleBrands] = useState<VehicleOption[]>(
    []
  );

  const [vehicleTypeId, setVehicleTypeId] = useState<number | null>(
    null
  );

  const [vehicleBrandId, setVehicleBrandId] =
    useState<number | null>(null);

  const [loadingOptions, setLoadingOptions] = useState(false);

  // ============================================================
  // CUSTOMER SEARCH
  // ============================================================

  const [matches, setMatches] = useState<CustomerMatch[]>([]);

  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerMatch | null>(null);

  const [searchingCustomers, setSearchingCustomers] =
    useState(false);

  const [showSuggestions, setShowSuggestions] =
    useState(false);

  // ============================================================
  // SUBMIT
  // ============================================================

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchTimeout =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  // ============================================================
  // NORMALIZE NAME
  // ============================================================

  function normalizeName(value: string) {
    return value
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase();
  }

  // ============================================================
  // LOAD VEHICLE OPTIONS FROM ODOO
  // ============================================================

  async function loadLeadOptions() {
    try {
      setLoadingOptions(true);

      const response = await apiRequest(
        `${API_URL}/crm/lead-options`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Lead options API returned ${response.status}`
        );
      }

      const data: LeadOptions = await response.json();

      setVehicleTypes(
        Array.isArray(data?.vehicle_types)
          ? data.vehicle_types
          : []
      );

      setVehicleBrands(
        Array.isArray(data?.vehicle_brands)
          ? data.vehicle_brands
          : []
      );
    } catch (err) {
      console.error(
        "Failed to load vehicle options:",
        err
      );

      // Don't block lead creation if the optional
      // vehicle data cannot be loaded.
      setVehicleTypes([]);
      setVehicleBrands([]);
    } finally {
      setLoadingOptions(false);
    }
  }

  // ============================================================
  // LOAD OPTIONS WHEN MODAL OPENS
  // ============================================================

  useEffect(() => {
    if (!open) {
      return;
    }

    loadLeadOptions();
  }, [open]);

  // ============================================================
  // RESET
  // ============================================================

  function resetForm() {
    setName("");
    setPhone("");
    setEmail("");
    setDescription("");

    setReservationStart("");
    setReservationEnd("");

    setVehicleTypeId(null);
    setVehicleBrandId(null);

    setMatches([]);
    setSelectedCustomer(null);
    setShowSuggestions(false);

    setError(null);
  }

  function handleClose() {
    if (saving) return;

    resetForm();
    onClose();
  }

  // ============================================================
  // SEARCH EXISTING CUSTOMERS
  // ============================================================

  useEffect(() => {
    if (!open) {
      return;
    }

    const query = name.trim();

    if (query.length < 2) {
      setMatches([]);
      setShowSuggestions(false);
      setSearchingCustomers(false);
      return;
    }

    if (selectedCustomer) {
      return;
    }

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    searchTimeout.current = setTimeout(async () => {
      try {
        setSearchingCustomers(true);

        const response = await apiRequest(
          `${API_URL}/customers/search?q=${encodeURIComponent(
            query
          )}`,
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error(
            `Customer search returned ${response.status}`
          );
        }

        const data = await response.json();

        const customerMatches: CustomerMatch[] =
          Array.isArray(data?.matches)
            ? data.matches
            : [];

        setMatches(customerMatches);
        setShowSuggestions(
          customerMatches.length > 0
        );
      } catch (err) {
        console.error(
          "Failed to search existing customers:",
          err
        );

        setMatches([]);
        setShowSuggestions(false);
      } finally {
        setSearchingCustomers(false);
      }
    }, 300);

    return () => {
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, [name, open, selectedCustomer]);

  // ============================================================
  // SELECT EXISTING CUSTOMER
  // ============================================================

  function handleSelectCustomer(
    customer: CustomerMatch
  ) {
    setSelectedCustomer(customer);

    setName(customer.name);

    if (customer.phone) {
      setPhone(customer.phone);
    }

    if (customer.email) {
      setEmail(customer.email);
    }

    setMatches([]);
    setShowSuggestions(false);
    setError(null);
  }

  // ============================================================
  // CREATE LEAD
  // ============================================================

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!name.trim()) {
      setError("Lead name is required.");
      return;
    }

    // Only validate dates when the user actually started
    // filling them in. Both remain optional.
    if (
      reservationStart &&
      reservationEnd &&
      reservationEnd < reservationStart
    ) {
      setError(
        "Reservation end date cannot be before the start date."
      );
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const response = await apiRequest(
        `${API_URL}/crm/leads`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: name.trim(),

            phone:
              phone.trim() || null,

            email:
              email.trim() || null,

            description:
              description.trim() || null,

            partner_id:
              selectedCustomer?.id ?? null,

            // ==================================================
            // OPTIONAL RENTAL REQUIREMENTS
            // ==================================================

            reservation_start:
              reservationStart || null,

            reservation_end:
              reservationEnd || null,

            vehicle_type_id:
              vehicleTypeId ?? null,

            vehicle_brand_id:
              vehicleBrandId ?? null,
          }),
        }
      );

      if (!response.ok) {
        let message =
          `Lead API returned ${response.status}`;

        try {
          const data = await response.json();

          if (
            typeof data?.detail === "string"
          ) {
            message = data.detail;
          }
        } catch {
          // Keep HTTP status message.
        }

        throw new Error(message);
      }

      resetForm();
      onClose();
      onCreated?.();
    } catch (err) {
      console.error(
        "Failed to create lead:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to create lead."
      );
    } finally {
      setSaving(false);
    }
  }

  // ============================================================
  // DON'T RENDER
  // ============================================================

  if (!open) {
    return null;
  }

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          handleClose();
        }
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_30px_100px_rgba(0,0,0,.55)]">

        {/* ======================================================
            HEADER
        ====================================================== */}

        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">

          <div className="flex items-center gap-2">

            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#C8F065]/10 text-lime-ink">
              <UserRound size={16} />
            </div>

            <div>
              <h2 className="font-[Syne] text-sm font-semibold text-text">
                Add Lead
              </h2>

              <p className="mt-0.5 text-[10px] text-muted">
                Create a new prospect
              </p>
            </div>

          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-secondary hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={16} />
          </button>

        </div>

        {/* ======================================================
            FORM
        ====================================================== */}

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">

            {/* ==================================================
                CONTACT
            ================================================== */}

            <section>

              <div className="mb-3">

                <h3 className="text-xs font-semibold text-text">
                  Contact
                </h3>

                <p className="mt-0.5 text-[10px] text-muted">
                  Lead and customer information
                </p>

              </div>

              {/* NAME / CUSTOMER SEARCH */}

              <div className="relative">

                <label className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                  Lead name
                  <span className="ml-1 text-pink-ink">
                    *
                  </span>
                </label>

                <div className="relative">

                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  />

                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);

                      if (
                        selectedCustomer &&
                        normalizeName(
                          event.target.value
                        ) !==
                          normalizeName(
                            selectedCustomer.name
                          )
                      ) {
                        setSelectedCustomer(null);
                      }

                      setError(null);
                    }}
                    onFocus={() => {
                      if (
                        matches.length > 0 &&
                        !selectedCustomer
                      ) {
                        setShowSuggestions(true);
                      }
                    }}
                    placeholder="e.g. Ahmed Ben Ali"
                    className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-10 text-sm text-text outline-none placeholder:text-muted transition focus:border-[#C8F065]/50"
                  />

                  {searchingCustomers && (
                    <Loader2
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted"
                    />
                  )}

                </div>

                {/* CUSTOMER SUGGESTIONS */}

                {showSuggestions &&
                  !selectedCustomer &&
                  matches.length > 0 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-border bg-surface shadow-[0_20px_50px_rgba(0,0,0,.45)]">

                      <div className="border-b border-border px-3 py-2">

                        <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
                          Existing contacts
                        </div>

                        <div className="mt-0.5 text-[10px] text-muted">
                          Select a contact to link this new lead
                        </div>

                      </div>

                      <div className="max-h-64 overflow-y-auto">

                        {matches.map(
                          (customer) => {

                            const exactNameMatch =
                              normalizeName(
                                customer.name
                              ) ===
                              normalizeName(
                                name
                              );

                            return (
                              <button
                                key={
                                  customer.id
                                }
                                type="button"
                                onMouseDown={(
                                  event
                                ) => {
                                  event.preventDefault();
                                }}
                                onClick={() =>
                                  handleSelectCustomer(
                                    customer
                                  )
                                }
                                className="w-full border-b border-border px-3 py-3 text-left transition last:border-0 hover:bg-surface-secondary"
                              >

                                <div className="flex items-start gap-3">

                                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#C8F065]/10 text-lime-ink">
                                    <UserRound
                                      size={
                                        14
                                      }
                                    />
                                  </div>

                                  <div className="min-w-0 flex-1">

                                    <div className="flex items-center gap-2">

                                      <span className="truncate text-sm font-medium text-text">
                                        {
                                          customer.name
                                        }
                                      </span>

                                      {exactNameMatch && (
                                        <span className="shrink-0 rounded-md bg-[#F06AAA]/10 px-1.5 py-0.5 text-[9px] font-medium text-pink-ink">
                                          Possible duplicate
                                        </span>
                                      )}

                                    </div>

                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">

                                      {customer.phone && (
                                        <span>
                                          {
                                            customer.phone
                                          }
                                        </span>
                                      )}

                                      {customer.email && (
                                        <span className="truncate">
                                          {
                                            customer.email
                                          }
                                        </span>
                                      )}

                                    </div>

                                    <div className="mt-1.5">

                                      {customer.is_customer ? (
                                        <span className="text-[9px] text-lime-ink">
                                          Existing CRM customer
                                        </span>
                                      ) : (
                                        <span className="text-[9px] text-muted">
                                          Existing contact
                                        </span>
                                      )}

                                    </div>

                                  </div>

                                </div>

                              </button>
                            );
                          }
                        )}

                      </div>

                      <div className="border-t border-border bg-background px-3 py-2">

                        <div className="text-[9px] text-muted">
                          Selecting a contact creates a new lead linked
                          to the existing customer.
                        </div>

                      </div>

                    </div>
                  )}

                {/* SELECTED CUSTOMER */}

                {selectedCustomer && (
                  <div className="mt-2 rounded-xl border border-[#C8F065]/20 bg-[#C8F065]/5 p-3">

                    <div className="flex items-start gap-3">

                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#C8F065]/10 text-lime-ink">
                        <Check size={15} />
                      </div>

                      <div className="min-w-0 flex-1">

                        <div className="text-[9px] font-medium uppercase tracking-wider text-lime-ink">
                          Linked to existing customer
                        </div>

                        <div className="mt-1 truncate text-sm font-medium text-text">
                          {
                            selectedCustomer.name
                          }
                        </div>

                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">

                          {selectedCustomer.phone && (
                            <span>
                              {
                                selectedCustomer.phone
                              }
                            </span>
                          )}

                          {selectedCustomer.email && (
                            <span className="truncate">
                              {
                                selectedCustomer.email
                              }
                            </span>
                          )}

                        </div>

                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(
                            null
                          );
                          setName("");
                          setPhone("");
                          setEmail("");
                        }}
                        disabled={saving}
                        className="shrink-0 text-[10px] text-muted transition hover:text-text"
                      >
                        Change
                      </button>

                    </div>

                  </div>
                )}

              </div>

              {/* PHONE + EMAIL */}

              <div className="mt-4 grid gap-4 sm:grid-cols-2">

                <div>

                  <label className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                    Phone
                  </label>

                  <div className="relative">

                    <Phone
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />

                    <input
                      value={phone}
                      onChange={(event) =>
                        setPhone(
                          event.target.value
                        )
                      }
                      placeholder="+216 ..."
                      className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-text outline-none placeholder:text-muted transition focus:border-[#C8F065]/50"
                    />

                  </div>

                </div>

                <div>

                  <label className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                    Email
                  </label>

                  <div className="relative">

                    <Mail
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />

                    <input
                      type="email"
                      value={email}
                      onChange={(event) =>
                        setEmail(
                          event.target.value
                        )
                      }
                      placeholder="customer@example.invalid"
                      className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-text outline-none placeholder:text-muted transition focus:border-[#C8F065]/50"
                    />

                  </div>

                </div>

              </div>

            </section>

            {/* ==================================================
                RENTAL REQUIREMENTS
            ================================================== */}

            <section className="rounded-xl border border-border bg-background p-4">

              <div className="mb-4">

                <div className="flex items-center gap-2">

                  <CalendarDays
                    size={15}
                    className="text-lime-ink"
                  />

                  <h3 className="text-xs font-semibold text-text">
                    Rental requirements
                  </h3>

                  <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[9px] text-muted">
                    Optional
                  </span>

                </div>

                <p className="mt-1 text-[10px] text-muted">
                  Capture the customer&apos;s initial rental needs.
                  These can be refined later.
                </p>

              </div>

              {/* DATES */}

              <div className="grid gap-4 sm:grid-cols-2">

                <div>

                  <label className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                    Reservation start
                  </label>

                  <input
                    type="datetime-local"
                    value={
                      reservationStart
                    }
                    onChange={(event) =>
                      setReservationStart(
                        event.target.value
                      )
                    }
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none transition focus:border-[#C8F065]/50"
                  />

                </div>

                <div>

                  <label className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                    Reservation end
                  </label>

                  <input
                    type="datetime-local"
                    value={reservationEnd}
                    min={
                      reservationStart ||
                      undefined
                    }
                    onChange={(event) =>
                      setReservationEnd(
                        event.target.value
                      )
                    }
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none transition focus:border-[#C8F065]/50"
                  />

                </div>

              </div>

              {/* VEHICLE TYPE + BRAND */}

              <div className="mt-4 grid gap-4 sm:grid-cols-2">

                {/* VEHICLE TYPE */}

                <div>

                  <label className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                    Vehicle type
                  </label>

                  <div className="relative">

                    <select
                      value={
                        vehicleTypeId ??
                        ""
                      }
                      onChange={(event) => {
                        const value =
                          event.target
                            .value;

                        setVehicleTypeId(
                          value
                            ? Number(value)
                            : null
                        );
                      }}
                      disabled={
                        loadingOptions
                      }
                      className="h-10 w-full appearance-none rounded-lg border border-border bg-surface px-3 pr-9 text-sm text-text outline-none transition focus:border-[#C8F065]/50 disabled:opacity-50"
                    >

                      <option
                        value=""
                        className="bg-surface"
                      >
                        Any vehicle type
                      </option>

                      {vehicleTypes.map(
                        (type) => (
                          <option
                            key={
                              type.id
                            }
                            value={
                              type.id
                            }
                            className="bg-surface"
                          >
                            {type.name}
                          </option>
                        )
                      )}

                    </select>

                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
                    />

                  </div>

                </div>

                {/* VEHICLE BRAND */}

                <div>

                  <label className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                    Vehicle brand
                  </label>

                  <div className="relative">

                    <select
                      value={
                        vehicleBrandId ??
                        ""
                      }
                      onChange={(event) => {
                        const value =
                          event.target
                            .value;

                        setVehicleBrandId(
                          value
                            ? Number(value)
                            : null
                        );
                      }}
                      disabled={
                        loadingOptions
                      }
                      className="h-10 w-full appearance-none rounded-lg border border-border bg-surface px-3 pr-9 text-sm text-text outline-none transition focus:border-[#C8F065]/50 disabled:opacity-50"
                    >

                      <option
                        value=""
                        className="bg-surface"
                      >
                        Any brand
                      </option>

                      {vehicleBrands.map(
                        (brand) => (
                          <option
                            key={
                              brand.id
                            }
                            value={
                              brand.id
                            }
                            className="bg-surface"
                          >
                            {brand.name}
                          </option>
                        )
                      )}

                    </select>

                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
                    />

                  </div>

                </div>

              </div>

              {loadingOptions && (
                <div className="mt-3 flex items-center gap-2 text-[10px] text-muted">

                  <Loader2
                    size={12}
                    className="animate-spin"
                  />

                  Loading vehicle options...

                </div>
              )}

            </section>

            {/* ==================================================
                NOTES
            ================================================== */}

            <section>

              <label className="mb-1.5 block text-[11px] font-medium text-text-secondary">
                Notes
              </label>

              <textarea
                value={description}
                onChange={(event) =>
                  setDescription(
                    event.target.value
                  )
                }
                placeholder="Rental requirements, source, follow-up notes..."
                rows={4}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text outline-none placeholder:text-muted transition focus:border-[#C8F065]/50"
              />

            </section>

            {/* ==================================================
                ERROR
            ================================================== */}

            {error && (
              <div className="rounded-lg border border-[#F06AAA]/30 bg-[#F06AAA]/5 px-3 py-2.5 text-xs text-pink-ink">
                {error}
              </div>
            )}

          </div>

          {/* ====================================================
              FOOTER
          ==================================================== */}

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">

            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="h-9 rounded-lg border border-border bg-surface-secondary px-4 text-xs font-medium text-text-secondary transition hover:text-text disabled:opacity-40"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="flex h-9 items-center gap-2 rounded-lg bg-[#C8F065] px-4 text-xs font-semibold text-[#09090B] transition hover:bg-[#d7ff80] disabled:cursor-not-allowed disabled:opacity-60"
            >

              {saving ? (
                <Loader2
                  size={14}
                  className="animate-spin"
                />
              ) : (
                <Plus size={14} />
              )}

              {saving
                ? "Creating..."
                : "Create Lead"}

            </button>

          </div>

        </form>

      </div>
    </div>
  );
}
