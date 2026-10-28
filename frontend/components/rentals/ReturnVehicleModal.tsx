"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/ui/Modal";
import ReturnInspectionFields from "@/components/rentals/ReturnInspectionFields";
import { apiFetch } from "@/lib/api";
import { notifyFleetCareChanged } from "@/components/fleet/FleetCare";
import { formatDate } from "@/lib/format";
import { buildReturnPayload, emptyReturnInspection, odometerUnit, type NextVehicleState, type ReturnForm, type ReturnRecord } from "@/lib/fleet-bookings";

type ReturnBooking = {
  id: number; name: string; customer: string | null;
  pickup_date: string | null; return_date: string | null; pending_return: ReturnRecord | null;
};
type ReturnOptions = {
  vehicle: { id: number; name: string; license_plate: string | null; odometer: number; odometer_unit: string };
  bookings: ReturnBooking[];
};
type Props = { vehicleId: number; orderId?: number; initialNextState?: NextVehicleState;
  onClose: () => void; onReturned: () => void | Promise<void> };
const inputClass = "mt-1 w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-text outline-none focus:border-lime/60 disabled:opacity-60";

function initialForm(booking: ReturnBooking | undefined, nextState: NextVehicleState): ReturnForm {
  const saved = booking?.pending_return;
  return { orderId: booking ? String(booking.id) : "", odometer: saved?.odometer == null ? "" : String(saved.odometer),
    returnNotes: saved?.return_notes || "", damageNotes: saved?.damage_notes || "", nextState: saved?.next_state || nextState,
    inspection: saved?.inspection || emptyReturnInspection(), damaged: saved?.damaged || false };
}

export default function ReturnVehicleModal({ vehicleId, orderId, initialNextState = "Nettoyage", onClose, onReturned }: Props) {
  const [options, setOptions] = useState<ReturnOptions | null>(null);
  const [form, setForm] = useState<ReturnForm>(() => initialForm(undefined, initialNextState));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const saving = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    apiFetch<ReturnOptions>(`/cars/${vehicleId}/return-options`).then(data => {
      if (!active) return;
      // A rental detail page must never fall back to returning another booking.
      const bookings = orderId ? data.bookings.filter(booking => booking.id === orderId) : data.bookings;
      setOptions({ ...data, bookings });
      const selected = bookings.length === 1 ? bookings[0] : undefined;
      setForm(initialForm(selected, initialNextState));
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Unable to load return details.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [vehicleId, orderId, initialNextState, retry]);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const pending = options?.bookings.find(booking => String(booking.id) === form.orderId)?.pending_return;
  function close() { if (!saving.current) onClose(); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || saved || !options) return;
    setError("");
    let payload;
    try { payload = buildReturnPayload(form, options.vehicle.odometer || 0, pending); }
    catch (err) { setError(err instanceof Error ? err.message : "Check the return details."); return; }
    saving.current = true; setBusy(true);
    try {
      await apiFetch(`/cars/${vehicleId}/return`, { method: "POST", body: JSON.stringify(payload) });
      setSaved(true);
      notifyFleetCareChanged();
      try { await onReturned(); }
      catch { setError("Return saved. Close this form and refresh the page to see the updated booking."); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the return. Keep these details and retry.");
      // Recover a saved partial return without letting the agent change its values.
      try {
        const latest = await apiFetch<ReturnOptions>(`/cars/${vehicleId}/return-options`);
        const bookings = orderId ? latest.bookings.filter(booking => booking.id === orderId) : latest.bookings;
        const selected = bookings.find(booking => String(booking.id) === form.orderId);
        if (selected?.pending_return) {
          setOptions({ ...latest, bookings }); setForm(initialForm(selected, initialNextState));
        }
      } catch { /* Retain the entered values when connectivity is unavailable. */ }
    } finally { saving.current = false; setBusy(false); }
  }

  return createPortal(
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Record vehicle return" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]");
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <Modal open title="Record vehicle return" subtitle={options ? `${options.vehicle.name}${options.vehicle.license_plate ? ` · ${options.vehicle.license_plate}` : ""}` : "Confirm the booking, mileage and vehicle condition."} onClose={close}>
        {loading ? <p className="text-sm text-muted">Loading return details…</p> : <>
          {error && <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
          {!options ? <button type="button" className="text-sm text-lime-ink" onClick={() => { setLoading(true); setError(""); setRetry(value => value + 1); }}>Retry</button>
          : !options.bookings.length ? <p className="text-sm text-text-secondary">No collected booking is available to return. Open the rental to verify pickup or its return status.</p>
          : <form onSubmit={submit} className="space-y-4">
            {pending && <p className="rounded-lg border border-border bg-surface-secondary p-3 text-sm text-text-secondary">An earlier return is unfinished. These saved details will complete it.</p>}
            <label className="block text-sm text-text-secondary">Booking to return
              <select required className={inputClass} value={form.orderId} disabled={busy || saved} onChange={event => setForm(initialForm(options.bookings.find(booking => String(booking.id) === event.target.value), initialNextState))}>
                <option value="">Choose booking…</option>
                {options.bookings.map(booking => <option key={booking.id} value={booking.id}>{booking.name} · {booking.customer || "Customer"} · {formatDate(booking.return_date)}</option>)}
              </select>
            </label>
            <label className="block text-sm text-text-secondary">Return odometer ({odometerUnit(options.vehicle.odometer_unit)})
              <input required={!pending} type="number" min={options.vehicle.odometer || 0} step="any" className={inputClass} value={form.odometer} disabled={busy || saved || !!pending} onChange={event => setForm({ ...form, odometer: event.target.value })} />
              <span className="mt-1 block text-xs text-muted">Saved reading: {options.vehicle.odometer || 0} {odometerUnit(options.vehicle.odometer_unit)}. Enter the reading shown on the vehicle.</span>
              {pending && pending.odometer === null && <span className="mt-1 block text-xs text-muted">This earlier return kept the existing mileage. Retry will finish it without changing the odometer.</span>}
            </label>
            <label className="block text-sm text-text-secondary">Return notes
              <textarea rows={2} maxLength={4000} className={inputClass} value={form.returnNotes} disabled={busy || saved || !!pending} onChange={event => setForm({ ...form, returnNotes: event.target.value })} />
            </label>
            <ReturnInspectionFields value={{ inspection: form.inspection || emptyReturnInspection(), damaged: form.damaged || false, damageNotes: form.damageNotes }}
              disabled={busy || saved || !!pending} onChange={condition => setForm({ ...form, ...condition,
                nextState: condition.damaged && form.nextState === "Disponible" ? "Maintenance" : form.nextState })} />
            <label className="block text-sm text-text-secondary">Next vehicle state
              <select className={inputClass} value={form.nextState} disabled={busy || saved || !!pending} onChange={event => setForm({ ...form, nextState: event.target.value as NextVehicleState })}>
                <option value="Nettoyage">Nettoyage · Cleaning</option><option value="Disponible" disabled={form.damaged}>Disponible · Available</option><option value="Maintenance">Maintenance</option>
              </select>
            </label>
            <p className="text-xs text-muted">This completes only the selected booking and updates the vehicle odometer. Its invoices and payments remain available.</p>
            {form.orderId && <a className="block text-sm text-lime-ink underline" href={`/dashboard/rentals/${form.orderId}#security-deposit`}>Review deposit refund on the booking after saving the return</a>}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm text-text disabled:opacity-50" onClick={close}>{saved ? "Close" : "Cancel"}</button>
              <button disabled={busy || saved || !form.orderId} className="rounded-lg border border-lime/40 bg-lime/15 px-4 py-2 text-sm font-semibold text-lime-ink disabled:opacity-50">{busy ? "Saving return…" : saved ? "Return saved" : "Confirm return"}</button>
            </div>
          </form>}
        </>}
      </Modal>
    </div>, document.body,
  );
}
