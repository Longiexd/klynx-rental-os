"use client";

import { useRef, useState } from "react";
import ReturnInspectionFields from "@/components/rentals/ReturnInspectionFields";
import { emptyReturnInspection, type ReturnConditionForm, type ReturnRecord } from "@/lib/fleet-bookings";
import { apiFetch } from "@/lib/api";

export default function ReturnInspectionReview({ orderId, record, onSaved }: {
  orderId: number; record: ReturnRecord; onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState<ReturnConditionForm>({
    inspection: record.inspection || emptyReturnInspection(),
    damaged: record.damaged ?? !!record.damage_notes, damageNotes: record.damage_notes,
  });
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      await apiFetch(`/sales/${orderId}/return-inspection`, { method: "PUT", body: JSON.stringify({
        inspection: value.inspection, damaged: value.damaged, damage_notes: value.damageNotes.trim(),
      }) });
      setSaved(true);
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save the vehicle inspection."); }
    finally { saving.current = false; setBusy(false); }
  }

  return <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <ReturnInspectionFields value={value} onChange={next => { setValue(next); setSaved(false); }} disabled={busy} />
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {saved && <p role="status" className="text-sm text-lime-ink">Vehicle inspection saved.</p>}
    <button disabled={busy} className="rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-surface-secondary disabled:opacity-50">{busy ? "Saving…" : "Save vehicle inspection"}</button>
  </form>;
}
