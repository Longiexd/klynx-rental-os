"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  CalendarDays,
  Car,
  CircleDollarSign,
  FileText,
  Search,
} from "lucide-react";

import CreateRentalModal from "@/components/rentals/CreateRentalModal";
import { PageHeader } from "@/components/ui/PageHeader";

import {
  getRentalState as classifyRentalState,
  rentalStateMeta,
  toneClasses,
} from "@/lib/status";
import { formatDate as sharedFormatDate } from "@/lib/format";
import { API_URL, apiRequest } from "@/lib/api-config";


type Customer = {
  id: number;
  name: string;
};


type Opportunity = {
  id: number;
  name: string;
};


type Sale = {
  id: number;
  name: string;
  customer: Customer | null;
  state: string;
  booking_status?: string;
  returned?: boolean;
  date_order: string | null;
  commitment_date: string | null;
  amount_total: number;
  invoice_status: string;
  opportunity: Opportunity | null;
  order_line_ids: number[];
  vehicle_id?: number | null;
  vehicle_name?: string | null;
};


type Vehicle = {
  id: number;
  name: string;
  license_plate: string | null;
};


type Invoice = {
  id: number;
  name: string | false;
  customer: Customer | null;
  state: string;
  invoice_date: string | false;
  due_date: string | false;
  amount_total: number;
  amount_residual: number;
  payment_state: string;
  origin: string | false;
};


type SalesResponse = {
  count: number;
  sales: Sale[];
};


type InvoicesResponse = {
  count: number;
  invoices: Invoice[];
};


type CarsResponse = {
  cars: Vehicle[];
};


type CreateRentalResult = {
  sale: Sale;
};



function formatDate(value: string | null | false) {
  return sharedFormatDate(value || null);
}

function getInvoiceForSale(sale: Sale, invoices: Invoice[]) {
  return invoices.find((invoice) => invoice.origin === sale.name);
}

// Thin wrapper: classification/colors now live once in lib/status.ts.
// Kept as a local function so the ~15 call sites below didn't need
// touching.
function getRentalState(sale: Sale) {
  const meta = rentalStateMeta(classifyRentalState(sale));
  const classes = toneClasses(meta.tone);

  return {
    label: meta.label,
    className: `${classes.border} ${classes.bg} ${classes.text}`,
  };
}


export default function RentalsPage() {
  const router = useRouter();
  const [bookingFilter, setBookingFilter] = useState("all");

  const [
    sales,
    setSales,
  ] = useState<Sale[]>([]);

  const [
    invoices,
    setInvoices,
  ] = useState<Invoice[]>([]);

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
    search,
    setSearch,
  ] = useState("");

  const [
    showCreateForm,
    setShowCreateForm,
  ] = useState(false);

  /*
   * These are populated when CRM opens
   * Rentals through URL parameters.
   */
  const [
    initialCustomerId,
    setInitialCustomerId,
  ] = useState<
    number | null
  >(null);

  const [
    initialOpportunityId,
    setInitialOpportunityId,
  ] = useState<
    number | null
  >(null);


  // =========================================================
  // LOAD RENTALS
  // =========================================================

  const loadRentals =
    useCallback(
      async () => {

        try {

          setLoading(true);

          setError(null);

          const [
            salesResponse,
            invoicesResponse,
            carsResponse,
          ] =
            await Promise.all([

              apiRequest(
                `${API_URL}/sales`,
                {
                  cache:
                    "no-store",
                }
              ),

              apiRequest(
                `${API_URL}/invoices`,
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
            !invoicesResponse.ok
          ) {
            throw new Error(
              `Invoices API returned ${invoicesResponse.status}`
            );
          }


          if (
            !carsResponse.ok
          ) {
            throw new Error(
              `Cars API returned ${carsResponse.status}`
            );
          }


          const salesData:
            SalesResponse =
            await salesResponse.json();


          const invoicesData:
            InvoicesResponse =
            await invoicesResponse.json();


          const carsData:
            CarsResponse =
            await carsResponse.json();


          setSales(
            salesData.sales ||
            []
          );

          setInvoices(
            invoicesData.invoices ||
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
              : "Unable to load rental data."
          );

        } finally {

          setLoading(false);

        }

      },
      []
    );


  useEffect(() => {
    void loadRentals();
  }, [
    loadRentals,
  ]);


  // =========================================================
  // OPEN CREATE FORM
  // =========================================================

  const openCreateForm =
    useCallback(
      (
        customerId?: number | null,
        opportunityId?: number | null
      ) => {

        setInitialCustomerId(
          customerId ??
            null
        );

        setInitialOpportunityId(
          opportunityId ??
            null
        );

        setShowCreateForm(
          true
        );

      },
      []
    );


  // =========================================================
  // SUPPORT /rentals?new=1
  //
  // AND
  //
  // /rentals?new=1&customer_id=12
  // /rentals?new=1&opportunity_id=45
  // =========================================================

  useEffect(() => {

    const params =
      new URLSearchParams(
        window.location.search
      );

    if (
      params.get("new") !==
      "1"
    ) {
      return;
    }

    const customerId =
      params.get(
        "customer_id"
      );

    const opportunityId =
      params.get(
        "opportunity_id"
      );

    openCreateForm(
      customerId
        ? Number(customerId)
        : null,

      opportunityId
        ? Number(
            opportunityId
          )
        : null
    );

  }, [
    openCreateForm,
  ]);


  // =========================================================
  // RENTAL CREATED
  // =========================================================

  function handleRentalCreated(payload: unknown) {
    const result = payload as CreateRentalResult;

    if (result?.sale) {
      setSales((current) => [
        result.sale,
        ...current.filter((sale) => sale.id !== result.sale.id),
      ]);
    }

    /*
     * Reload from Odoo shortly after creation.
     *
     * This keeps invoices, sales totals and
     * calendar-related data synchronized.
     */
    void loadRentals();

  }


  // =========================================================
  // SEARCH
  // =========================================================

  const matchingSales = sales.filter(sale => bookingFilter === "all" || (bookingFilter === "confirmed" ? ["confirmed", "pickup_due", "ongoing", "return_due", "completed"].includes(classifyRentalState(sale)) : classifyRentalState(sale) === bookingFilter));

  const filteredSales =
    useMemo(() => {

      const query =
        search
          .toLowerCase()
          .trim();

      if (!query) {
        return matchingSales;
      }

      return matchingSales.filter(
        (sale) =>
          [
            sale.name,
            sale.customer?.name,
            sale.opportunity?.name,
            sale.state,
            sale.invoice_status,
            sale.vehicle_name,
          ]
            .filter(Boolean)
            .some(
              (value) =>
                value!
                  .toLowerCase()
                  .includes(
                    query
                  )
            )
      );

    }, [
      matchingSales,
      search,
    ]);


  // =========================================================
  // STATS
  // =========================================================

  const confirmed =
    sales.filter(
      (sale) =>
        ["confirmed", "pickup_due", "ongoing", "return_due", "completed"].includes(classifyRentalState(sale))
    ).length;


  const totalValue =
    sales.reduce(
      (
        sum,
        sale
      ) =>
        sum +
        (
          sale.amount_total ||
          0
        ),
      0
    );


  const outstanding =
    invoices.reduce(
      (
        sum,
        invoice
      ) =>
        sum +
        (
          invoice.amount_residual ||
          0
        ),
      0
    );


  // =========================================================
  // RENDER
  // =========================================================

  return (

    <main
      className="
        mx-auto
        max-w-[1500px]
        p-5
        sm:p-8
      "
    >

      <PageHeader
        breadcrumb="Rentals"
        title="Rentals"
        subtitle="Rental operations, sales and invoicing."
        action={
          <button
            type="button"
            onClick={() => openCreateForm()}
            className="flex h-9 items-center justify-center gap-2 rounded-lg bg-lime px-4 text-xs font-medium text-[#111113] shadow-glow-lime transition hover:bg-lime-dark"
          >
            <CalendarDays size={14} />
            New booking
          </button>
        }
      />


      {/* =====================================================
          STATS
      ===================================================== */}

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Filter bookings">
        {[["all", "All", sales.length], ["draft", "Quotations", sales.filter(sale => classifyRentalState(sale) === "draft").length], ["confirmed", "Confirmed", confirmed], ["cancelled", "Cancelled", sales.filter(sale => classifyRentalState(sale) === "cancelled").length]].map(([value, label, count]) => <button key={value} onClick={() => setBookingFilter(String(value))} aria-pressed={bookingFilter === value} className={`rounded-xl border p-4 text-left ${bookingFilter === value ? "border-lime/50 bg-lime/5" : "border-border bg-surface"}`}><span className={value === "confirmed" ? "text-lime-ink" : value === "cancelled" ? "text-danger" : "text-text-secondary"}>{label}</span><strong className="mt-2 block text-2xl text-text">{loading ? "—" : count}</strong></button>)}
      </section>

      <section
        className="
          mt-7
          grid
          gap-3
          sm:grid-cols-3
        "
      >

        <div
          className="
            rounded-2xl
            border
            border-border
            bg-surface
            p-5
          "
        >

          <div
            className="
              flex
              items-center
              justify-between
            "
          >

            <span
              className="
                text-xs
                text-muted
              "
            >
              Rentals
            </span>

            <Car
              size={16}
              className="
                text-lime-ink
              "
            />

          </div>


          <div
            className="
              mt-3
              text-3xl
              font-semibold
              text-text
            "
          >
            {loading
              ? "—"
              : confirmed}
          </div>


          <div
            className="
              mt-1
              text-xs
              text-muted
            "
          >
            confirmed orders
          </div>

        </div>


        <div
          className="
            rounded-2xl
            border
            border-border
            bg-surface
            p-5
          "
        >

          <div
            className="
              flex
              items-center
              justify-between
            "
          >

            <span
              className="
                text-xs
                text-muted
              "
            >
              Rental Value
            </span>

            <CircleDollarSign
              size={16}
              className="
                text-lime-ink
              "
            />

          </div>


          <div
            className="
              mt-3
              text-3xl
              font-semibold
              text-text
            "
          >
            {loading
              ? "—"
              : `${totalValue.toLocaleString()} TND`}
          </div>


          <div
            className="
              mt-1
              text-xs
              text-muted
            "
          >
            sales total
          </div>

        </div>


        <div
          className="
            rounded-2xl
            border
            border-orange-400/20
            bg-orange-400/[0.04]
            p-5
          "
        >

          <div
            className="
              flex
              items-center
              justify-between
            "
          >

            <span
              className="
                text-xs
                text-orange-300
              "
            >
              Outstanding
            </span>

            <FileText
              size={16}
              className="
                text-orange-400
              "
            />

          </div>


          <div
            className="
              mt-3
              text-3xl
              font-semibold
              text-text
            "
          >
            {loading
              ? "—"
              : `${outstanding.toLocaleString()} TND`}
          </div>


          <div
            className="
              mt-1
              text-xs
              text-orange-300
            "
          >
            unpaid invoice balance
          </div>

        </div>

      </section>


      {/* =====================================================
          SEARCH
      ===================================================== */}

      <section className="mt-5">

        <div className="relative">

          <Search
            size={16}
            className="
              absolute
              left-3
              top-1/2
              -translate-y-1/2
              text-muted
            "
          />

          <input
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
            placeholder="
              Search rentals, customers, orders...
            "
            className="
              h-10
              w-full
              rounded-xl
              border
              border-border
              bg-surface
              pl-10
              pr-4
              text-sm
              text-text
              outline-none
              placeholder:text-muted
              focus:border-[#C8F065]/50
            "
          />

        </div>

      </section>


      {/* =====================================================
          ERROR
      ===================================================== */}

      {error && (

        <div
          className="
            mt-4
            rounded-xl
            border
            border-red-900/40
            bg-red-950/20
            px-4
            py-3
            text-sm
            text-red-400
          "
        >
          {error}
        </div>

      )}


      {/* =====================================================
          RENTALS
      ===================================================== */}

      <section
        className="
          mt-5
          space-y-3
        "
      >

        {loading ? (

          <div
            className="
              rounded-2xl
              border
              border-border
              bg-surface
              px-5
              py-14
              text-center
              text-sm
              text-muted
            "
          >
            Loading rentals...
          </div>

        ) : filteredSales.length ===
          0 ? (

          <div
            className="
              rounded-2xl
              border
              border-border
              bg-surface
              px-5
              py-14
              text-center
              text-sm
              text-muted
            "
          >
            No rentals found.
          </div>

        ) : (

          filteredSales.map(
            (sale) => {

              const rentalState =
                getRentalState(
                  sale
                );

              const invoice =
                getInvoiceForSale(
                  sale,
                  invoices
                );


              const vehicle =
                sale.vehicle_name ||
                (
                  sale.vehicle_id
                    ? vehicles.find(
                        (vehicle) =>
                          vehicle.id ===
                          sale.vehicle_id
                      )?.name
                    : null
                );


              return (

                <article
                  key={sale.id}
                  onClick={() =>
                    router.push(`/dashboard/rentals/${sale.id}`)
                  }
                  className="
                    cursor-pointer
                    rounded-2xl
                    border
                    border-border
                    bg-surface
                    p-5
                    transition
                    hover:border-strong
                    hover:bg-surface
                  "
                >

                  <div
                    className="
                      flex
                      flex-col
                      gap-5
                      lg:flex-row
                      lg:items-center
                      lg:justify-between
                    "
                  >

                    {/* =================================================
                        RENTAL ID / CUSTOMER
                    ================================================= */}

                    <div
                      className="
                        flex
                        min-w-0
                        items-start
                        gap-4
                      "
                    >

                      <div
                        className="
                          flex
                          h-11
                          w-11
                          shrink-0
                          items-center
                          justify-center
                          rounded-xl
                          border
                          border-border
                          bg-surface-secondary
                        "
                      >

                        <Car
                          size={19}
                          className="
                            text-text-secondary
                          "
                        />

                      </div>


                      <div
                        className="
                          min-w-0
                        "
                      >

                        <div
                          className="
                            flex
                            flex-wrap
                            items-center
                            gap-2
                          "
                        >

                          <Link
                            href={`/dashboard/rentals/${sale.id}`}
                            className="
                              font-mono
                              text-sm
                              font-medium
                              text-text
                              hover:text-lime-ink
                            "
                          >
                            {sale.name}
                          </Link>


                          <span
                            className={`
                              rounded-full
                              border
                              px-2.5
                              py-1
                              text-[10px]
                              font-semibold
                              uppercase
                              tracking-wider
                              ${rentalState.className}
                            `}
                          >
                            {
                              rentalState.label
                            }
                          </span>

                        </div>


                        {sale.customer ? (

                          <Link
                            href={`/dashboard/customers/${sale.customer.id}`}
                            onClick={(event) =>
                              event.stopPropagation()
                            }
                            className="
                              mt-1
                              block
                              text-sm
                              text-text
                              hover:text-lime-ink
                            "
                          >
                            {
                              sale.customer.name
                            }
                          </Link>

                        ) : (

                          <div
                            className="
                              mt-1
                              text-sm
                              text-text
                            "
                          >
                            Unknown customer
                          </div>

                        )}


                        <div
                          className="
                            mt-1
                            text-xs
                            text-muted
                          "
                        >
                          {
                            sale.opportunity?.name ||
                            "Rental opportunity"
                          }
                        </div>

                      </div>

                    </div>


                    {/* =================================================
                        DETAILS
                    ================================================= */}

                    <div
                      className="
                        grid
                        grid-cols-2
                        gap-x-8
                        gap-y-3
                        text-sm
                        sm:grid-cols-4
                      "
                    >

                      <div>

                        <div
                          className="
                            text-[10px]
                            uppercase
                            tracking-wider
                            text-muted
                          "
                        >
                          Rental Start
                        </div>

                        <div
                          className="
                            mt-1
                            text-text
                          "
                        >
                          {
                            formatDate(
                              sale.date_order
                            )
                          }
                        </div>

                      </div>


                      <div>

                        <div
                          className="
                            text-[10px]
                            uppercase
                            tracking-wider
                            text-muted
                          "
                        >
                          Vehicle
                        </div>

                        <div
                          className="
                            mt-1
                            text-text-secondary
                          "
                        >
                          {
                            vehicle ||
                            "Unassigned"
                          }
                        </div>

                      </div>


                      <div>

                        <div
                          className="
                            text-[10px]
                            uppercase
                            tracking-wider
                            text-muted
                          "
                        >
                          Invoice
                        </div>

                        <div className="mt-1">

                          {invoice ? (

                            <span
                              className={
                                invoice.payment_state ===
                                "paid"

                                  ? "text-lime-ink"

                                  : "text-orange-300"
                              }
                            >
                              {
                                invoice.payment_state ===
                                "paid"

                                  ? "Paid"

                                  : invoice.payment_state
                              }
                            </span>

                          ) : (

                            <span
                              className="
                                text-muted
                              "
                            >
                              No invoice
                            </span>

                          )}

                        </div>

                      </div>


                      <div
                        className="
                          text-right
                        "
                      >

                        <div
                          className="
                            text-[10px]
                            uppercase
                            tracking-wider
                            text-muted
                          "
                        >
                          Total
                        </div>

                        <div
                          className="
                            mt-1
                            font-medium
                            text-text
                          "
                        >
                          {
                            sale.amount_total.toLocaleString()
                          }{" "}
                          TND
                        </div>

                      </div>

                    </div>

                  </div>


                  {/* =================================================
                      FOOTER
                  ================================================= */}

                  <div
                    className="
                      mt-5
                      flex
                      flex-wrap
                      items-center
                      justify-between
                      gap-3
                      border-t
                      border-border
                      pt-4
                    "
                  >

                    <div
                      className="
                        flex
                        items-center
                        gap-2
                        text-xs
                        text-muted
                      "
                    >

                      <CalendarDays
                        size={13}
                      />

                      Ordered{" "}
                      {
                        formatDate(
                          sale.date_order
                        )
                      }


                      {sale.commitment_date && (
                        <>
                          <span>
                            →
                          </span>

                          <span
                            className="
                              text-text-secondary
                            "
                          >
                            Return{" "}
                            {
                              formatDate(
                                sale.commitment_date
                              )
                            }
                          </span>
                        </>
                      )}

                    </div>


                    <div
                      className="
                        text-xs
                        text-muted
                      "
                    >
                      Invoice status:{" "}

                      <span
                        className="
                          text-text-secondary
                        "
                      >
                        {
                          sale.invoice_status
                        }
                      </span>

                    </div>

                  </div>

                </article>

              );

            }
          )

        )}

      </section>


      {/* =====================================================
          CREATE RENTAL
      ===================================================== */}

      <CreateRentalModal
        open={
          showCreateForm
        }

        onClose={() =>
          setShowCreateForm(
            false
          )
        }

        customerId={initialCustomerId}
        opportunityId={initialOpportunityId}
        onCreated={handleRentalCreated}
      />

    </main>
  );
}
