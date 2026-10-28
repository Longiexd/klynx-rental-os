"use client";

import { useKlynxUI } from "@/components/providers/UIProvider";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import { activityRequest, activityHref, noteText, type Activity } from "./api";

type Option = { id: number; name: string; category?: string };
const input = "w-full rounded-lg border border-strong bg-surface-secondary px-3 py-2.5 text-sm text-text";

export default function ActivitiesPanel({ leadId, saleId, compact = false, onCompleted }: {
  leadId?: number; saleId?: number; compact?: boolean; onCompleted?: () => void;
}) {
  const { t } = useKlynxUI();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState(compact && !leadId && !saleId ? "due" : "all");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<Option[]>([]);
  const [leads, setLeads] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const requestActivities = useCallback(async () => {
    // Keep earlier booking reminders visible while new rental follow-ups belong to its prospect.
    const paths = [leadId && `/activities?lead_id=${leadId}`, saleId && `/activities?sale_id=${saleId}`].filter(Boolean) as string[];
    const results = await Promise.all((paths.length ? paths : ["/activities"]).map(path => activityRequest<{ activities: Activity[] }>(path)));
    return results.flatMap(result => result.activities).sort((a, b) => a.date_deadline.localeCompare(b.date_deadline) || a.id - b.id);
  }, [leadId, saleId]);
  const load = useCallback(async () => {
    try {
      setActivities(await requestActivities());
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load activities."); }
    finally { setLoading(false); }
  }, [requestActivities]);
  useEffect(() => {
    let active = true;
    requestActivities().then(result => { if (active) {
        setActivities(result); setError("");
        const id = Number(new URLSearchParams(window.location.search).get("activity"));
        if (id > 0) setSelected(id);
      } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Unable to load activities."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requestActivities]);

  async function startCreate() {
    setBusy(true);
    setError("");
    try {
      const [available, prospects] = await Promise.all([
        activityRequest<{ types: Option[] }>(`/activities/types?res_model=${leadId || !saleId ? "crm.lead" : "sale.order"}`),
        (leadId || saleId) ? Promise.resolve({ leads: [] as Option[] }) : activityRequest<{ leads: Option[] }>("/crm/leads"),
      ]);
      setTypes(available.types); setLeads(prospects.leads); setOpen(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load activity options."); }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      await activityRequest("/activities", { method: "POST", body: JSON.stringify({
        ...(leadId ? { lead_id: leadId } : saleId ? { sale_id: saleId } : { lead_id: Number(data.get("lead")) }), activity_type_id: Number(data.get("type")),
        summary: data.get("summary"), date_deadline: data.get("date"), note: data.get("note"),
      }) });
      setOpen(false); setNotice("Activity scheduled. It is also visible in the calendar."); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to schedule activity."); }
    finally { setBusy(false); }
  }

  async function reschedule(id: number, dateDeadline: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await activityRequest(`/activities/${id}`, { method: "PATCH", body: JSON.stringify({ date_deadline: dateDeadline }) });
      setNotice("Due date updated and synced with the calendar."); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to reschedule this activity."); }
    finally { setBusy(false); }
  }

  async function complete(id: number) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await activityRequest<{ warning?: string }>(`/activities/${id}/complete`, {
        method: "POST", body: JSON.stringify({ feedback }),
      });
      setNotice(result.warning || "Activity completed. Continue from the linked record.");
      setSelected(null); setFeedback(""); await load(); onCompleted?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to complete activity."); }
    finally { setBusy(false); }
  }

  const due = activities.filter(item => ["today", "overdue"].includes(item.state));
  const filtered = activities.filter(item => filter === "all" || (filter === "due" ? ["today", "overdue"].includes(item.state) : item.state === filter));
  const visible = compact && !showAll ? filtered.slice(0, 5) : filtered;
  return (
    <section className={`${compact ? "space-y-2 p-3" : "space-y-4 p-5"} rounded-2xl border border-[var(--todo-border)] bg-surface`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className={`${compact ? "text-base" : "text-lg"} font-semibold text-text`}>To do <span className="text-[var(--todo-text)]">{due.length} due</span></h2>
          <p className="mt-1 text-xs text-text-secondary">{leadId ? "Linked to this prospect; earlier booking reminders are retained." : saleId ? "Linked to this booking." : "Schedule a call or email reminder, then continue from the linked record."}</p></div>
        <button type="button" disabled={busy} onClick={startCreate} className="klynx-todo-selected inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm disabled:opacity-50"><Plus size={16} /> Schedule activity</button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error} <button type="button" onClick={load} className="underline">Refresh</button></p>}
      {notice && <p role="status" className="rounded-lg border border-[var(--status-available-border)] bg-[var(--status-available-bg)] p-3 text-sm text-[var(--status-available-text)]">{notice}</p>}
      {(!compact || open) && <p className="text-xs text-[var(--todo-text)]">Email activities remind an agent to send the email; they do not send it automatically.</p>}
      {open && <form onSubmit={create} className="grid gap-4 rounded-xl border border-[var(--todo-border)] p-4 sm:grid-cols-2">
        {!leadId && !saleId && <label className="space-y-1 text-sm text-text-secondary">Prospect<select name="lead" required className={input} defaultValue=""><option value="" disabled>Select prospect</option>{leads.map(lead => <option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label>}
        <label className="space-y-1 text-sm text-text-secondary">Activity<select name="type" required className={input} defaultValue={types.find(type => type.category === "phonecall")?.id || ""}><option value="" disabled>Select activity type</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
        <label className="space-y-1 text-sm text-text-secondary">Due date<input name="date" type="date" required min={new Date().toISOString().slice(0, 10)} className={input} /></label>
        <label className="space-y-1 text-sm text-text-secondary">Title<input name="summary" required maxLength={250} placeholder={saleId && !leadId ? "Email invoice to customer" : "Call customer about this booking"} className={input} /></label>
        <label className="space-y-1 text-sm text-text-secondary sm:col-span-2">Notes / instructions<textarea name="note" maxLength={10000} rows={compact ? 2 : 3} className={input} /></label>
        <div className="flex gap-3 sm:col-span-2"><button disabled={busy} className="klynx-todo-fill rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save activity"}</button><button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-sm text-text-secondary">Cancel</button></div>
      </form>}
      <div className="flex flex-wrap gap-2">{[["all", "All"], ["due", "Due now"], ["today", "Today"], ["overdue", "Overdue"], ["planned", "Upcoming"]].map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-sm ${filter === value ? "klynx-todo-selected" : "border border-transparent text-text-secondary hover:bg-surface-secondary hover:text-text"}`}>{label}</button>)}</div>
      {loading ? <p className="text-sm text-text-secondary">Loading activities…</p> : !visible.length && !error ? <p className="text-sm text-text-secondary">No activities in this view. Schedule the next follow-up above.</p> : visible.map(item => (
        <article key={item.id} className={`rounded-xl border ${compact ? "p-3" : "p-4"} ${item.state === "overdue" ? "border-red-400/30 bg-red-400/5" : item.state === "today" ? "border-amber-400/30 bg-amber-400/5" : "border-[var(--todo-border)] bg-[var(--todo-bg-soft)]"}`}>
          <button type="button" onClick={() => { setSelected(selected === item.id ? null : item.id); setFeedback(""); }} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
            <span className="font-medium text-text">{item.summary || (item.activity_type_id && item.activity_type_id[1]) || "Follow up"} · {item.res_name}</span>
            <span className={`text-sm ${item.state === "overdue" ? "text-danger" : item.state === "today" ? "text-orange-ink" : "text-[var(--todo-text)]"}`}>{item.date_deadline} · {item.state}</span>
          </button>
          {selected === item.id && <div className="mt-3 space-y-3">
            <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">{noteText(item.note) || "No instructions yet."}</p>
            <div className="flex flex-wrap justify-between gap-2 text-sm"><Link href={activityHref(item)} className="klynx-todo-link font-medium underline">Open {item.res_model === "sale.order" ? "booking" : "prospect"} →</Link><span className="text-text-secondary">Assigned to {item.user_id ? item.user_id[1] : "—"}</span></div>
            <label className="block space-y-1 text-sm text-text-secondary">Due date<input type="date" min={new Date().toISOString().slice(0, 10)} defaultValue={item.date_deadline} disabled={busy} onBlur={event => { if (event.target.value && event.target.value !== item.date_deadline) void reschedule(item.id, event.target.value); }} className={`${input} max-w-[180px]`} /></label>
            <label className="block space-y-1 text-sm text-text-secondary">Outcome / call notes<textarea value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={10000} rows={2} className={input} /></label>
            {item.res_model !== "sale.order" && item.activity_category === "phonecall" && <p className="text-sm text-text-secondary">Completing the call moves an earlier prospect to Contacted when that stage is configured.</p>}
            <button type="button" disabled={busy} onClick={() => complete(item.id)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--status-available-border)] bg-[var(--status-available-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--status-available-text)] disabled:opacity-50"><Check size={16} /> {busy ? "Saving…" : "Mark done"}</button>
          </div>}
        </article>
      ))}
      {compact && filtered.length > 5 && <button type="button" className="klynx-todo-link text-sm font-medium underline" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${filtered.length} activities`}</button>}
      {compact && <Link href={leadId ? `/crm/leads/${leadId}` : saleId ? `/dashboard/rentals/${saleId}` : "/dashboard/activities"} className="klynx-todo-link inline-block text-sm font-medium underline">{leadId ? "Open prospect follow-ups" : saleId ? "Open booking" : `${t("View all activities")} (${activities.length})`} →</Link>}
    </section>
  );
}
