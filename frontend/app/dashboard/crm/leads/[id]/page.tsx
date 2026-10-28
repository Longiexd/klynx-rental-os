"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ActivitiesPanel from "@/components/activities/ActivitiesPanel";
import { activityRequest, noteText } from "@/components/activities/api";
import { PageHeader } from "@/components/ui/PageHeader";
import CreateRentalModal from "@/components/rentals/CreateRentalModal";
import { formatCurrency } from "@/lib/format";

type Prospect = {
  id: number; name: string; partner_id: [number, string] | false; phone: string | false;
  mobile: string | false; email_from: string | false; stage_id: [number, string] | false;
  description: string | false; expected_revenue: number;
  rentals: { id: number; name: string; state: string; amount_total: number }[];
};

export default function ProspectPage() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<Prospect | null>(null);
  const [error, setError] = useState("");
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [editingField, setEditingField] = useState<"phone" | "email" | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try { setLead(await activityRequest<Prospect>(`/crm/leads/${id}`)); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load prospect."); }
  }, [id]);
  useEffect(() => {
    let active = true;
    activityRequest<Prospect>(`/crm/leads/${id}`)
      .then(result => { if (active) { setLead(result); setError(""); } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Unable to load prospect."); });
    return () => { active = false; };
  }, [id]);

  async function saveContact(field: "phone" | "email") {
    setSaving(true);
    try {
      await activityRequest(`/crm/leads/${id}/contact`, { method: "PATCH", body: JSON.stringify({ [field]: draft }) });
      setEditingField(null);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : `Unable to update ${field}.`); }
    finally { setSaving(false); }
  }

  return <main className="mx-auto max-w-[1400px] space-y-6 p-5 sm:p-8">
    <Link href="/crm/leads" className="text-sm text-text-secondary hover:text-text">← All prospects</Link>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {!lead ? <p className="text-text-secondary">{error ? "Prospect unavailable." : "Loading prospect…"}</p> : <>
      <PageHeader breadcrumb="Prospects" title={lead.name} subtitle={lead.stage_id ? lead.stage_id[1] : "No stage"} action={<button onClick={() => setCreatingBooking(true)} className="rounded-lg bg-lime px-4 py-2 text-sm font-medium text-[#111113]">Prepare quotation</button>} />
      <section className="grid gap-5 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-3">
        <div className="min-w-0"><p className="text-sm text-text-secondary">Customer</p><p className="mt-1 break-words font-medium text-text">{lead.partner_id ? lead.partner_id[1] : lead.name}</p></div>
        <EditableRow field="phone" label="Phone" value={lead.phone || lead.mobile || "—"} editingField={editingField} draft={draft} saving={saving} onEdit={(field, value) => { setEditingField(field); setDraft(value === "—" ? "" : value); }} onDraftChange={setDraft} onCancel={() => setEditingField(null)} onSave={saveContact} />
        <EditableRow field="email" label="Email" value={lead.email_from || "—"} editingField={editingField} draft={draft} saving={saving} onEdit={(field, value) => { setEditingField(field); setDraft(value === "—" ? "" : value); }} onDraftChange={setDraft} onCancel={() => setEditingField(null)} onSave={saveContact} />
        <div className="sm:col-span-3"><h2 className="font-semibold text-text">Prospect notes</h2><p className="mt-2 whitespace-pre-wrap break-words text-text-secondary">{noteText(lead.description) || "No notes available."}</p></div>
      </section>
      <div className="flex flex-wrap gap-4 text-sm">
        {lead.partner_id && <Link href={`/dashboard/customers/${lead.partner_id[0]}`} className="text-lime-ink">Open customer →</Link>}
        {(lead.phone || lead.mobile) && <a href={`tel:${lead.phone || lead.mobile}`} className="text-lime-ink">Call prospect</a>}
        {lead.email_from && <a href={`mailto:${lead.email_from}`} className="text-lime-ink">Email prospect</a>}
      </div>
      <section className="rounded-xl border border-border bg-surface p-5"><h2 className="font-semibold text-text">Quotations & bookings</h2><p className="mt-1 text-sm text-text-secondary">Continue from quotation to invoice and payment in the booking card.</p>
        {lead.rentals?.length ? lead.rentals.map(rental => <Link key={rental.id} href={`/dashboard/rentals/${rental.id}`} className="mt-3 flex flex-wrap justify-between gap-2 rounded-lg bg-surface-secondary p-3 text-sm text-text hover:text-lime-ink"><span>{rental.name} · {rental.state === "cancel" ? "Cancelled" : ["draft", "sent"].includes(rental.state) ? "Quotation" : "Sales order"}</span><span>{formatCurrency(rental.amount_total)} →</span></Link>) : <p className="mt-3 text-sm text-muted">No quotation yet. Prepare one above.</p>}
      </section>
      <ActivitiesPanel key={lead.id} leadId={lead.id} onCompleted={load} />
      <CreateRentalModal open={creatingBooking} onClose={() => setCreatingBooking(false)} opportunityId={lead.id} customerId={lead.partner_id ? lead.partner_id[0] : null} initialCustomerName={lead.name} />
    </>}
  </main>;
}

// Declared at module scope (not inside ProspectPage's render) so it
// keeps a stable identity across renders — a component recreated on
// every render loses its DOM node identity and, e.g., input focus.
// State it needs lives in the parent and comes in as props instead.
function EditableRow({
  field,
  label,
  value,
  editingField,
  draft,
  saving,
  onEdit,
  onDraftChange,
  onCancel,
  onSave,
}: {
  field: "phone" | "email";
  label: string;
  value: string;
  editingField: "phone" | "email" | null;
  draft: string;
  saving: boolean;
  onEdit: (field: "phone" | "email", value: string) => void;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onSave: (field: "phone" | "email") => void;
}) {
  const editing = editingField === field;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2"><p className="text-sm text-text-secondary">{label}</p>
        {!editing && <button type="button" onClick={() => onEdit(field, value)} className="text-xs text-lime-ink hover:underline">Edit</button>}
      </div>
      {editing ? (
        <div className="mt-1 flex items-center gap-2">
          <input autoFocus value={draft} onChange={event => onDraftChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter") onSave(field); if (event.key === "Escape") onCancel(); }} className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-text outline-none focus:border-lime" />
          <button type="button" disabled={saving} onClick={() => onSave(field)} className="shrink-0 text-xs font-medium text-lime-ink disabled:opacity-50">{saving ? "…" : "Save"}</button>
          <button type="button" onClick={onCancel} className="shrink-0 text-xs text-muted">Cancel</button>
        </div>
      ) : <p className="mt-1 break-words text-text">{value}</p>}
    </div>
  );
}
