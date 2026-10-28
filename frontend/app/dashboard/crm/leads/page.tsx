"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  LayoutGrid,
  List,
  Mail,
  Phone,
  Plus,
  Search,
  TrendingUp,
  UserRound,
} from "lucide-react";

import CreateRentalModal from "@/components/rentals/CreateRentalModal";
import { PageHeader } from "@/components/ui/PageHeader";
import { SortableHeader, type SortDirection } from "@/components/ui/SortableHeader";
import { API_URL, apiRequest } from "@/lib/api-config";

type LeadSortKey = "created" | "name" | "customer" | "stage" | "revenue";

// =========================================================
// TYPES
// =========================================================

type Lead = {
  id: number;
  name: string;
  customer: { id: number; name: string } | null;
  phone: string | null;
  email: string | null;
  stage: string | null;
  stage_id: number | null;
  expected_revenue: number;
  created: string | null;
  rental: { id: number; name: string } | null;
};

type Stage = {
  id: number;
  name: string;
  sequence: number;
};

type View = "list" | "kanban";

// =========================================================
// API
// =========================================================

// =========================================================
// STAGE COLORS
// =========================================================

function getStageColors(stageName: string | null) {
  const stage = (stageName || "").trim().toLowerCase();

  // =========================================================
  // NEW LEAD — PINK
  // =========================================================

  if (
    stage === "new lead" ||
    stage === "new" ||
    stage === "nouveau" ||
    stage === "nouvelle" ||
    stage === "nouveau prospect"
  ) {
    return {
      dot: "bg-[#F06AAA]",
      text: "text-pink-ink",
      tag: "border-[#F06AAA]/30 bg-[#F06AAA]/10",
      count: "bg-[#F06AAA]/10 text-pink-ink",
    };
  }

  // =========================================================
  // CONTACTÉ — VIOLET
  // =========================================================

  if (
    stage === "contacté" ||
    stage === "contacte" ||
    stage === "contacted" ||
    stage === "documents"
  ) {
    return {
      dot: "bg-[#A78BFA]",
      text: "text-violet-ink",
      tag: "border-[#A78BFA]/30 bg-[#A78BFA]/10",
      count: "bg-[#A78BFA]/10 text-violet-ink",
    };
  }

  // =========================================================
  // DEVIS ENVOYÉ — ORANGE
  // =========================================================

  if (
    stage === "devis envoyé" ||
    stage === "devis envoye" ||
    stage === "quotation sent"
  ) {
    return {
      dot: "bg-[#FB923C]",
      text: "text-orange-ink",
      tag: "border-[#FB923C]/30 bg-[#FB923C]/10",
      count: "bg-[#FB923C]/10 text-orange-ink",
    };
  }

  // =========================================================
  // RÉSERVATION CONFIRMÉE — GREEN
  // =========================================================

  if (
    stage === "réservation confirmée" ||
    stage === "reservation confirmée" ||
    stage === "reservation confirmee" ||
    stage === "reservation confirmed"
  ) {
    return {
      dot: "bg-lime-ink",
      text: "text-lime-ink",
      tag: "border-[#C8F065]/30 bg-[#C8F065]/10",
      count: "bg-[#C8F065]/10 text-lime-ink",
    };
  }

  // =========================================================
  // VÉHICULE REMIS — BLUE
  // =========================================================

  if (
    stage === "véhicule remis" ||
    stage === "vehicule remis" ||
    stage === "vehicle delivered"
  ) {
    return {
      dot: "bg-[#60A5FA]",
      text: "text-blue-ink",
      tag: "border-[#60A5FA]/30 bg-[#60A5FA]/10",
      count: "bg-[#60A5FA]/10 text-blue-ink",
    };
  }

  // =========================================================
  // WON / GAGNÉ — GREEN
  // =========================================================

  if (
    stage === "won" ||
    stage === "gagné" ||
    stage === "gagne" ||
    stage === "location terminée" ||
    stage === "location terminee" ||
    stage === "rental completed"
  ) {
    return {
      dot: "bg-lime-ink",
      text: "text-lime-ink",
      tag: "border-[#C8F065]/30 bg-[#C8F065]/10",
      count: "bg-[#C8F065]/10 text-lime-ink",
    };
  }

  // =========================================================
  // LOST / PERDU — RED
  // =========================================================

  if (
    stage === "lost" ||
    stage === "perdu"
  ) {
    return {
      dot: "bg-[#EF4444]",
      text: "text-red-ink",
      tag: "border-[#EF4444]/30 bg-[#EF4444]/10",
      count: "bg-[#EF4444]/10 text-red-ink",
    };
  }

  // =========================================================
  // FALLBACK
  // =========================================================

  return {
    dot: "bg-muted",
    text: "text-text-secondary",
    tag: "border-border bg-surface-secondary",
    count: "bg-surface-secondary text-muted",
  };
}

// =========================================================
// PAGE
// =========================================================

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState(false);
  const loadingData = useRef(false);

  const [search, setSearch] = useState("");

  const [sortKey, setSortKey] = useState<LeadSortKey>("created");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  function handleSort(key: LeadSortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "created" ? "desc" : "asc");
    }
  }
  const [view, setView] = useState<View>("list");

  const [bookingOpen, setBookingOpen] = useState(false);

  // =========================================================
  // LOAD DATA FROM ODOO / API
  // =========================================================

  const loadData = useCallback(() => {
    if (loadingData.current) return Promise.resolve();
    loadingData.current = true;
    return apiRequest(`${API_URL}/crm/leads/sync-journey`, { method: "POST" })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null)
      .then(async result => {
        try {
          setSyncWarning(!result || Boolean(result.crm_warning));
          setLoading(true);
          setError(null);
          const [leadsResponse, stagesResponse] = await Promise.all([
            apiRequest(`${API_URL}/crm/leads`, { cache: "no-store" }),
            apiRequest(`${API_URL}/crm/stages`, { cache: "no-store" }),
          ]);
          if (!leadsResponse.ok) throw new Error(`Leads API returned ${leadsResponse.status}`);
          if (!stagesResponse.ok) throw new Error(`Stages API returned ${stagesResponse.status}`);
          const [leadsData, stagesData] = await Promise.all([leadsResponse.json(), stagesResponse.json()]);
          setLeads(Array.isArray(leadsData.leads) ? leadsData.leads : []);
          setStages(Array.isArray(stagesData.stages) ? stagesData.stages : []);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Unable to load prospect data.");
        } finally {
          setLoading(false);
          loadingData.current = false;
        }
      });
  }, []);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void loadData(); };
    void loadData();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadData]);

  // =========================================================
  // MOVE LEAD BETWEEN ODOO STAGES
  // =========================================================

  async function moveLeadToStage(
    leadId: number,
    stageId: number,
    stageName: string
  ) {
    const previousLeads = leads;

    // Optimistic UI update
    setLeads((current) =>
      current.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              stage_id: stageId,
              stage: stageName,
            }
          : lead
      )
    );

    try {
      const response = await apiRequest(
        `${API_URL}/crm/leads/${leadId}/stage`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stage_id: stageId,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Stage API returned ${response.status}`
        );
      }
    } catch (err) {
      console.error(
        "Failed to update lead stage:",
        err
      );

      // Restore previous state
      setLeads(previousLeads);

      setError(
        "Unable to update lead stage."
      );
    }
  }

  // =========================================================
  // SEARCH
  // =========================================================

  const filteredLeads = leads.filter(
    (lead) => {
      const query = search
        .toLowerCase()
        .trim();

      if (!query) {
        return true;
      }

      return (
        (lead.name || "")
          .toLowerCase()
          .includes(query) ||

        (lead.customer?.name || "")
          .toLowerCase()
          .includes(query) ||

        (lead.phone || "")
          .toLowerCase()
          .includes(query) ||

        (lead.email || "")
          .toLowerCase()
          .includes(query) ||

        (lead.stage || "")
          .toLowerCase()
          .includes(query)
      );
    }
  );

  const sortedLeads = useMemo(() => {
    const list = [...filteredLeads];

    list.sort((a, b) => {
      let result = 0;

      switch (sortKey) {
        case "created":
          result = (a.created || "").localeCompare(b.created || "");
          break;
        case "name":
          result = (a.name || "").localeCompare(b.name || "");
          break;
        case "customer":
          result = (a.customer?.name || "").localeCompare(
            b.customer?.name || ""
          );
          break;
        case "stage":
          result = (a.stage_id ?? 0) - (b.stage_id ?? 0);
          break;
        case "revenue":
          result = (a.expected_revenue || 0) - (b.expected_revenue || 0);
          break;
      }

      return (sortDirection === "asc" ? result : -result) || b.id - a.id;
    });

    return list;
  }, [filteredLeads, sortKey, sortDirection]);

  // =========================================================
  // STATS
  // =========================================================

  const totalRevenue = leads.reduce(
    (sum, lead) =>
      sum +
      (Number(
        lead.expected_revenue
      ) || 0),
    0
  );

  const activeLeads = leads.filter(
    (lead) => {
      if (!lead.stage) {
        return true;
      }

      const stage =
        lead.stage.toLowerCase();

      return ![
        "won",
        "lost",
        "gagné",
        "gagne",
        "perdu",
      ].includes(stage);
    }
  ).length;

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <main className="min-h-screen p-5 sm:p-7 lg:p-8">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <PageHeader
        breadcrumb="Prospects"
        title="Prospects"
        subtitle="Manage potential customers and rental opportunities."
        action={
          <button
            type="button"
            onClick={() => setBookingOpen(true)}
            className="flex h-9 items-center justify-center gap-2 rounded-lg bg-lime px-4 text-xs font-medium text-[#111113] shadow-glow-lime transition hover:bg-lime-dark"
          >
            <Plus size={14} />
            New booking
          </button>
        }
      />

      {/* =====================================================
          STATS
      ===================================================== */}

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">

        {/* TOTAL */}

        <div className="rounded-2xl border border-border bg-surface p-5">

          <div className="mb-4 flex items-center justify-between">

            <span className="text-sm text-muted">
              Total Leads
            </span>

            <TrendingUp
              size={18}
              className="text-lime-ink"
            />

          </div>

          <div className="text-3xl font-semibold text-text">
            {loading
              ? "—"
              : leads.length}
          </div>

          <div className="mt-1 text-xs text-muted">
            Prospect opportunities
          </div>

        </div>

        {/* ACTIVE */}

        <div className="rounded-2xl border border-border bg-surface p-5">

          <div className="mb-4 flex items-center justify-between">

            <span className="text-sm text-muted">
              Active Leads
            </span>

            <UserRound
              size={18}
              className="text-pink-ink"
            />

          </div>

          <div className="text-3xl font-semibold text-text">
            {loading
              ? "—"
              : activeLeads}
          </div>

          <div className="mt-1 text-xs text-muted">
            Open opportunities
          </div>

        </div>

        {/* REVENUE */}

        <div className="rounded-2xl border border-border bg-surface p-5">

          <div className="mb-4 flex items-center justify-between">

            <span className="text-sm text-muted">
              Expected Revenue
            </span>

            <ArrowUpRight
              size={18}
              className="text-lime-ink"
            />

          </div>

          <div className="text-3xl font-semibold text-text">
            {loading
              ? "—"
              : `${totalRevenue.toLocaleString()} TND`}
          </div>

          <div className="mt-1 text-xs text-muted">
            Total pipeline value
          </div>

        </div>

      </div>

      {/* =====================================================
          TOOLBAR
      ===================================================== */}

      <div className="mb-4 flex flex-wrap items-center gap-3">

        <div className="relative w-full sm:w-auto sm:flex-1">

          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />

          <input
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
            placeholder="Search leads..."
            className="h-10 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-sm text-text outline-none placeholder:text-muted focus:border-[#C8F065]/50"
          />

        </div>

        <select
          aria-label="Sort prospects"
          value={`${sortKey}:${sortDirection}`}
          onChange={event => {
            const [key, direction] = event.target.value.split(":");
            setSortKey(key as LeadSortKey);
            setSortDirection(direction as SortDirection);
          }}
          className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm text-text sm:flex-none"
        >
          <option value="created:desc">Newest first</option>
          <option value="created:asc">Oldest first</option>
          <option value="name:asc">Name: A–Z</option>
          <option value="name:desc">Name: Z–A</option>
          <option value="customer:asc">Customer: A–Z</option>
          <option value="customer:desc">Customer: Z–A</option>
          <option value="stage:asc">Stage: ascending</option>
          <option value="stage:desc">Stage: descending</option>
          <option value="revenue:desc">Revenue: highest first</option>
          <option value="revenue:asc">Revenue: lowest first</option>
        </select>

        <div className="flex h-10 items-center rounded-xl border border-border bg-surface p-1">

          <button
            type="button"
            onClick={() =>
              setView("list")
            }
            className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition ${
              view === "list"
                ? "bg-[#C8F065] text-black"
                : "text-muted hover:text-text"
            }`}
          >
            <List size={14} />
            List
          </button>

          <button
            type="button"
            onClick={() =>
              setView("kanban")
            }
            className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition ${
              view === "kanban"
                ? "bg-[#C8F065] text-black"
                : "text-muted hover:text-text"
            }`}
          >
            <LayoutGrid size={14} />
            Kanban
          </button>

        </div>

      </div>

      {/* =====================================================
          ERROR
      ===================================================== */}

      {error && (
        <div className="mb-4 rounded-xl border border-[#F06AAA]/30 bg-[#F06AAA]/5 px-4 py-3 text-sm text-pink-ink">
          {error}
        </div>
      )}
      {syncWarning && <div role="status" className="mb-4 rounded-xl border border-border bg-surface-secondary px-4 py-3 text-sm text-text-secondary">
        CRM synchronization is pending. Rental actions are saved. Open Odoo to check the six rental stages, then retry.
        <button type="button" className="ml-2 text-lime-ink underline" disabled={loading} onClick={() => void loadData()}>Retry</button>
      </div>}

      {/* =====================================================
          VIEW
      ===================================================== */}

      {view === "list" ? (
        <LeadsTable
          leads={sortedLeads}
          loading={loading}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={handleSort}
        />
      ) : (
        <LeadsKanban
          leads={sortedLeads}
          stages={stages}
          loading={loading}
          onMoveLead={
            moveLeadToStage
          }
        />
      )}

      {/* =====================================================
          NEW BOOKING MODAL
      ===================================================== */}

      <CreateRentalModal
        open={bookingOpen}
        onClose={() =>
          setBookingOpen(false)
        }
        onCreated={loadData}
      />

    </main>
  );
}

// =========================================================
// LIST VIEW
// =========================================================

function LeadsTable({
  leads,
  loading,
  sortKey,
  sortDirection,
  onSort,
}: {
  leads: Lead[];
  loading: boolean;
  sortKey: LeadSortKey;
  sortDirection: SortDirection;
  onSort: (key: LeadSortKey) => void;
}) {
  return (
    <>
      <div className="space-y-3 md:hidden">
        {loading ? <p className="p-5 text-sm text-muted">Loading leads...</p> : !leads.length ? <p className="p-5 text-sm text-muted">No leads found.</p> : leads.map(lead => {
          const colors = getStageColors(lead.stage);
          return <Link key={lead.id} href={lead.rental ? `/dashboard/rentals/${lead.rental.id}` : `/crm/leads/${lead.id}`} className="block rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold text-text">{lead.name}</p><p className="mt-1 text-xs text-muted">{lead.rental?.name || `#${lead.id}`}</p></div><ArrowUpRight size={19} className="shrink-0 text-muted"/></div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full border px-2.5 py-1 text-xs ${colors.tag} ${colors.text}`}>{lead.stage || "No Stage"}</span><span className="text-sm font-semibold tabular-nums text-text">{(lead.expected_revenue || 0).toLocaleString()} TND</span></div>
            <p className="mt-3 truncate text-xs text-text-secondary">{lead.customer?.name || "No customer"}</p>
            {(lead.phone || lead.email) && <p className="mt-1 truncate text-xs text-muted">{lead.phone || lead.email}</p>}
          </Link>;
        })}
      </div>
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface md:block">

      <div className="overflow-x-auto">

        <table className="w-full min-w-[850px]">

          <thead>

            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">

              <SortableHeader
                label="Lead"
                sortKey="name"
                currentKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />

              <SortableHeader
                label="Customer"
                sortKey="customer"
                currentKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />

              <th className="px-5 py-3 font-medium">
                Contact
              </th>

              <SortableHeader
                label="Stage"
                sortKey="stage"
                currentKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />

              <SortableHeader
                label="Expected Revenue"
                sortKey="revenue"
                currentKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
                align="right"
              />

            </tr>

          </thead>

          <tbody>

            {loading ? (

              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-12 text-center text-sm text-muted"
                >
                  Loading leads...
                </td>
              </tr>

            ) : leads.length === 0 ? (

              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-12 text-center text-sm text-muted"
                >
                  No leads found.
                </td>
              </tr>

            ) : (

              leads.map((lead) => {

                const colors =
                  getStageColors(
                    lead.stage
                  );

                return (
                  <tr
                    key={lead.id}
                    className="border-b border-border last:border-0 transition hover:bg-surface-secondary"
                  >

                    {/* LEAD */}

                    <td className="px-5 py-4">

                      <Link href={lead.rental ? `/dashboard/rentals/${lead.rental.id}` : `/crm/leads/${lead.id}`} className="font-medium text-text hover:text-lime-ink">
                        {lead.name}
                      </Link>

                      <div className="mt-1 text-xs text-muted">
                        {lead.rental?.name || `#${lead.id}`}
                      </div>

                    </td>

                    {/* CUSTOMER */}

                    <td className="px-5 py-4 text-sm text-text-secondary">
                      {lead.customer?.name ||
                        "—"}
                    </td>

                    {/* CONTACT */}

                    <td className="px-5 py-4">

                      {lead.phone && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">

                          <Phone size={13} />

                          {lead.phone}

                        </div>
                      )}

                      {lead.email && (
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted">

                          <Mail size={13} />

                          {lead.email}

                        </div>
                      )}

                      {!lead.phone &&
                        !lead.email && (
                          <span className="text-xs text-muted">
                            —
                          </span>
                        )}

                    </td>

                    {/* STAGE */}

                    <td className="px-5 py-4">

                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${colors.tag} ${colors.text}`}
                      >

                        <span
                          className={`h-1.5 w-1.5 rounded-full ${colors.dot}`}
                        />

                        {lead.stage ||
                          "No Stage"}

                      </span>

                    </td>

                    {/* REVENUE */}

                    <td className="px-5 py-4 text-right text-sm font-medium text-text">

                      {(
                        lead.expected_revenue ||
                        0
                      ).toLocaleString()}{" "}
                      TND

                    </td>

                  </tr>
                );
              })

            )}

          </tbody>

        </table>

      </div>

    </div>
    </>
  );
}

// =========================================================
// KANBAN VIEW
// =========================================================

function LeadsKanban({
  leads,
  stages,
  loading,
  onMoveLead,
}: {
  leads: Lead[];
  stages: Stage[];
  loading: boolean;
  onMoveLead: (
    leadId: number,
    stageId: number,
    stageName: string
  ) => void;
}) {

  const [
    dragLeadId,
    setDragLeadId,
  ] = useState<number | null>(
    null
  );

  const [
    dragOverStageId,
    setDragOverStageId,
  ] = useState<number | null>(
    null
  );

  // =========================================================
  // GROUP LEADS BY ODOO STAGE ID
  // =========================================================

  const leadsByStage =
    useMemo(() => {

      const map =
        new Map<
          number,
          Lead[]
        >();

      // Create every Odoo stage
      for (const stage of stages) {
        map.set(
          stage.id,
          []
        );
      }

      // Put every lead into its actual Odoo stage
      for (const lead of leads) {

        if (
          lead.stage_id !==
            null &&
          map.has(
            lead.stage_id
          )
        ) {
          map
            .get(
              lead.stage_id
            )!
            .push(lead);
        }

      }

      return map;

    }, [leads, stages]);

  // =========================================================
  // LOADING
  // =========================================================

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-5 py-16 text-center text-sm text-muted">
        Loading pipeline...
      </div>
    );
  }

  // =========================================================
  // NO STAGES
  // =========================================================

  if (stages.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-5 py-16 text-center text-sm text-muted">
        No prospect stages configured yet.
      </div>
    );
  }

  // =========================================================
  // KANBAN
  // =========================================================

  return (
    <div className="flex snap-x gap-4 overflow-x-auto pb-3">

      {stages.map((stage) => {

        const stageLeads =
          leadsByStage.get(
            stage.id
          ) || [];

        const isDragOver =
          dragOverStageId ===
          stage.id;

        const colors =
          getStageColors(
            stage.name
          );

        return (
          <div
            key={stage.id}
            className={`w-[min(300px,calc(100vw-2rem))] shrink-0 snap-start rounded-2xl border bg-surface transition ${
              isDragOver
                ? "border-[#C8F065]/50 bg-[#C8F065]/[0.03]"
                : "border-border"
            }`}
            onDragOver={(event) => {
              event.preventDefault();

              setDragOverStageId(
                stage.id
              );
            }}
            onDragLeave={() => {
              setDragOverStageId(
                null
              );
            }}
            onDrop={(event) => {

              event.preventDefault();

              if (
                dragLeadId !==
                null
              ) {
                onMoveLead(
                  dragLeadId,
                  stage.id,
                  stage.name
                );
              }

              setDragLeadId(
                null
              );

              setDragOverStageId(
                null
              );
            }}
          >

            {/* =================================================
                STAGE HEADER
            ================================================= */}

            <div className="flex items-center justify-between border-b border-border px-4 py-3">

              <div className="flex items-center gap-2">

                <span
                  className={`h-2.5 w-2.5 rounded-full ${colors.dot}`}
                />

                <span
                  className={`text-xs font-semibold ${colors.text}`}
                >
                  {stage.name}
                </span>

              </div>

              <span
                className={`rounded-md px-2 py-1 text-[10px] font-medium ${colors.count}`}
              >
                {stageLeads.length}
              </span>

            </div>

            {/* =================================================
                STAGE CONTENT
            ================================================= */}

            <div className="min-h-[180px] space-y-3 p-3">

              {stageLeads.length === 0 ? (

                <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-border text-[11px] text-muted">
                  Drop leads here
                </div>

              ) : (

                stageLeads.map(
                  (lead) => (

                    <Link
                      key={lead.id}
                      href={lead.rental ? `/dashboard/rentals/${lead.rental.id}` : `/crm/leads/${lead.id}`}
                      draggable
                      onDragStart={() => {
                        setDragLeadId(
                          lead.id
                        );
                      }}
                      onDragEnd={() => {
                        setDragLeadId(
                          null
                        );

                        setDragOverStageId(
                          null
                        );
                      }}
                      className={`block cursor-grab rounded-xl border border-border bg-surface-secondary p-4 transition hover:border-strong focus-visible:outline-2 focus-visible:outline-lime-ink active:cursor-grabbing ${
                        dragLeadId ===
                        lead.id
                          ? "opacity-50"
                          : ""
                      }`}
                    >

                      {/* LEAD NAME */}

                      <div className="text-sm font-medium text-text hover:text-lime-ink">
                        {lead.name}
                      </div>

                      {/* CUSTOMER */}

                      <div className="mt-1 text-[11px] text-muted">
                        {lead.customer
                          ?.name ||
                          "No customer"}
                      </div>

                      {/* STAGE TAG */}

                      <div className="mt-3">

                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium ${colors.tag} ${colors.text}`}
                        >

                          <span
                            className={`h-1.5 w-1.5 rounded-full ${colors.dot}`}
                          />

                          {stage.name}

                        </span>

                      </div>

                      {/* FOOTER */}

                      <div className="mt-3 flex items-center justify-between">

                        <span className="text-[10px] text-muted">
                          {lead.rental?.name || `#${lead.id}`}
                        </span>

                        <span className="text-[10px] font-medium text-lime-ink">
                          {(
                            lead.expected_revenue ||
                            0
                          ).toLocaleString()}{" "}
                          TND
                        </span>

                      </div>

                    </Link>

                  )
                )

              )}

            </div>

          </div>
        );
      })}

    </div>
  );
}
