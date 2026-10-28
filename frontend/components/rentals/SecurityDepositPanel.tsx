"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { API_URL, apiRequest } from "@/lib/api-config";
import { inspectionChecksComplete, type ReturnRecord } from "@/lib/fleet-bookings";

type DepositEvent = { request_id: string; action: "refund" | "retain"; amount: number; note?: string; credit_note_id?: number; move_id?: number };
type Deposit = { required_amount: number; collected_amount: number; held_amount: number;
  refunded_amount: number; retained_amount: number; legacy_issue: string | null; events: DepositEvent[];
  currency?: string; currency_rounding?: number };
type Settlement = { request_id: string; action: "refund" | "retain"; amount: number; journal_id: number | null; note: string };
class SettlementRejected extends Error {}
const input = "mt-1 block w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-text";
const button = "rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-surface-secondary disabled:opacity-50";

export default function SecurityDepositPanel({ orderId, record, journals, onSaved, canInvoice }: {
  orderId: number; record?: ReturnRecord | null; journals: { id: number; name: string }[]; onSaved: () => Promise<void>; canInvoice: boolean;
}) {
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const pending = useRef<Settlement | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [action, setAction] = useState<"refund" | "retain">("refund");
  const [amount, setAmount] = useState("");
  const [journalId, setJournalId] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    const data = await apiFetch<Deposit>(`/sales/${orderId}/security-deposit`);
    setDeposit(data);
    if (pending.current && data.events.some(event => event.request_id === pending.current?.request_id)) {
      pending.current = null; setUncertain(false); setAmount(""); setNote(""); setError("");
      setNotice("Deposit settlement recorded in Odoo.");
    }
  }, [orderId]);
  useEffect(() => {
    let active = true;
    apiFetch<Deposit>(`/sales/${orderId}/security-deposit`).then(data => { if (active) { setDeposit(data); setError(""); } })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Unable to load the security deposit."); });
    return () => { active = false; };
  }, [orderId, record]);

  const checked = !!record?.inspection && inspectionChecksComplete(record.inspection);
  const remainderAfterDamage = !!record?.damaged && !!record.damage_notes.trim() && (deposit?.retained_amount || 0) > 0;
  const refundAllowed = record?.status === "completed" && checked && ((record.inspection?.approved && !record.damaged) || remainderAfterDamage);
  const retainAllowed = record?.status === "completed" && checked && record.damaged && !!record.damage_notes.trim();
  function money(value: number) {
    return `${value.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${deposit?.currency || "TND"}`;
  }

  async function settle() {
    if (saving.current || !deposit) return;
    const data = pending.current || { request_id: crypto.randomUUID(), action, amount: Number(amount),
      journal_id: action === "refund" ? Number(journalId) : null, note: note.trim() };
    if (!Number.isFinite(data.amount) || data.amount <= 0 || data.amount > deposit.held_amount) {
      setError("Enter an amount within the held deposit balance."); return;
    }
    saving.current = true; pending.current = data; setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiRequest(`${API_URL}/sales/${orderId}/security-deposit/settlements`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        const message = typeof result?.detail === "string" ? result.detail : "Unable to record the deposit settlement.";
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) throw new SettlementRejected(message);
        throw new Error(message);
      }
      pending.current = null; setUncertain(false); setAmount(""); setNote("");
      setNotice("Deposit settlement recorded in Odoo.");
      try { await load(); await onSaved(); }
      catch { setError("Deposit settlement saved. Refresh the booking to see its updated balance."); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record the deposit settlement.");
      if (err instanceof SettlementRejected) { pending.current = null; setUncertain(false); }
      else {
        setUncertain(true);
        try { await load(); } catch { /* Keep the same request for a safe retry. */ }
      }
    } finally { saving.current = false; setBusy(false); }
  }

  return <section id="security-deposit" className="mt-5 scroll-mt-5 rounded-xl border border-border bg-surface p-5">
    <h2 className="font-semibold text-text">Security deposit</h2>
    <p className="mt-2 text-sm text-text-secondary">Deposits are held separately from rental income. Only amounts retained for damage become income.</p>
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-lime-ink">{notice}</p>}
    {!deposit ? <button type="button" className={`${button} mt-3`} onClick={() => { setError(""); void load().catch(err => setError(err instanceof Error ? err.message : "Unable to load the security deposit.")); }}>Load deposit details</button>
      : deposit.required_amount <= 0 ? <p className="mt-3 text-sm text-muted">No security deposit on this booking.</p> : <>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[["Deposit required", deposit.required_amount], ["Deposit held", deposit.held_amount], ["Deposit refunded", deposit.refunded_amount], ["Retained for damage", deposit.retained_amount]].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 font-semibold text-text">{money(Number(value))}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-muted">Collect the deposit through the booking invoice and its payment. Select your dedicated deposit bank or cash account when recording that payment.</p>
        {canInvoice && <button disabled={busy} type="button" className={`${button} mt-3`} onClick={async () => {
          if (saving.current) return;
          saving.current = true; setBusy(true); setError("");
          try {
            await apiFetch(`/sales/${orderId}/invoice`, { method: "POST", body: JSON.stringify({ security_deposit_only: true }) });
            await onSaved(); await load(); setNotice("Security deposit invoice ready. Validate it and record payment below.");
          } catch (err) { setError(err instanceof Error ? err.message : "Unable to create the security deposit invoice."); }
          finally { saving.current = false; setBusy(false); }
        }}>Invoice security deposit</button>}
        {deposit.legacy_issue && <p role="alert" className="mt-3 text-sm text-danger">{deposit.legacy_issue}</p>}
        {!record || record.status !== "completed" ? <p className="mt-4 text-sm text-muted">Record the vehicle return before settling its deposit.</p>
          : !refundAllowed && !retainAllowed ? <p className="mt-4 text-sm text-muted">Complete the return inspection above. Approve the condition for a refund, or flag damage and add notes before retaining an amount.</p> : null}
        {remainderAfterDamage && deposit.held_amount > 0 && <p className="mt-3 text-sm text-text-secondary">Damage compensation is recorded. You can now return the remaining deposit.</p>}
        {record?.status === "completed" && deposit.held_amount > 0 && !deposit.legacy_issue && <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={event => { event.preventDefault(); void settle(); }}>
          <fieldset disabled={busy || uncertain} className="grid gap-3 sm:grid-cols-2 disabled:opacity-60">
            <label className="text-sm text-text-secondary">Deposit action<select className={input} value={action} onChange={event => setAction(event.target.value as "refund" | "retain")}><option value="refund">Return deposit after approval</option><option value="retain">Retain for damage</option></select></label>
            <label className="text-sm text-text-secondary">Amount<input required type="number" min={deposit.currency_rounding || 0.001} max={deposit.held_amount} step={deposit.currency_rounding || "any"} className={input} value={amount} onChange={event => setAmount(event.target.value)} /></label>
            {action === "refund" && <label className="text-sm text-text-secondary">Refund from<select required className={input} value={journalId} onChange={event => setJournalId(event.target.value)}><option value="">Select account...</option>{journals.map(journal => <option value={journal.id} key={journal.id}>{journal.name}</option>)}</select></label>}
            <label className="text-sm text-text-secondary sm:col-span-2">Settlement note<textarea required={action === "retain"} maxLength={4000} rows={2} className={input} value={note} onChange={event => setNote(event.target.value)} /></label>
          </fieldset>
          <p className="text-xs text-muted">Record a refund only after returning the money to the client. This saves the credit note and refund payment in Odoo.</p>
          {uncertain && <p className="text-sm text-text-secondary">This request is kept for a safe retry. Reload the deposit status before starting another settlement.</p>}
          <div className="flex flex-wrap gap-2"><button disabled={busy || (!uncertain && (action === "refund" ? !refundAllowed : !retainAllowed))} className={`${button} border-lime/40 bg-lime/15 text-lime-ink`}>{busy ? "Saving…" : uncertain ? "Retry saved settlement" : action === "refund" ? "Record deposit refund" : "Record damage retention"}</button>
            {uncertain && <button type="button" disabled={busy} className={button} onClick={() => { void load().catch(err => setError(err instanceof Error ? err.message : "Unable to load the security deposit.")); }}>Reload deposit status</button>}</div>
        </form>}
        {deposit.events.length > 0 && <ul className="mt-4 space-y-2 border-t border-border pt-4 text-sm text-text-secondary">{deposit.events.map(event => <li key={event.request_id} className="flex flex-wrap justify-between gap-2"><span>{event.action === "refund" ? "Deposit refunded" : "Retained for damage"}{event.note ? ` · ${event.note}` : ""}{event.credit_note_id ? <a className="ml-2 underline" href={`/api/backend/invoices/${event.credit_note_id}/document`}>Credit note</a> : null}</span><span>{money(event.amount)}</span></li>)}</ul>}
      </>}
  </section>;
}
