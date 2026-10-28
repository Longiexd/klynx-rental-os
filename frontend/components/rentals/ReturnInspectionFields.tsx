"use client";

import { inspectionChecksComplete, type ReturnConditionForm, type ReturnInspection } from "@/lib/fleet-bookings";

type Props = {
  value: ReturnConditionForm;
  onChange: (value: ReturnConditionForm) => void;
  disabled?: boolean;
};

const checks: { key: Exclude<keyof ReturnInspection, "approved">; label: string }[] = [
  { key: "body_checked", label: "Exterior and body checked" },
  { key: "interior_checked", label: "Interior checked" },
  { key: "fuel_keys_checked", label: "Fuel, keys and accessories checked" },
];

export default function ReturnInspectionFields({ value, onChange, disabled = false }: Props) {
  function updateCheck(key: Exclude<keyof ReturnInspection, "approved">, checked: boolean) {
    const inspection = { ...value.inspection, [key]: checked };
    if (!inspectionChecksComplete(inspection)) inspection.approved = false;
    onChange({ ...value, inspection });
  }

  return <fieldset disabled={disabled} className="space-y-3 rounded-lg border border-border p-4 disabled:opacity-60">
    <legend className="px-1 text-sm font-medium text-text">Return inspection</legend>
    {checks.map(check => <label key={check.key} className="flex items-center gap-2 text-sm text-text-secondary">
      <input type="checkbox" className="accent-lime" checked={value.inspection[check.key]} onChange={event => updateCheck(check.key, event.target.checked)} />
      {check.label}
    </label>)}
    <label className="flex items-center gap-2 text-sm text-text-secondary">
      <input type="checkbox" className="accent-lime" checked={value.damaged} onChange={event => onChange({ ...value,
        damaged: event.target.checked, inspection: { ...value.inspection, approved: event.target.checked ? false : value.inspection.approved } })} />
      Vehicle damaged
    </label>
    <label className="block text-sm text-text-secondary">Damage notes
      <textarea rows={2} required={value.damaged} maxLength={4000} className="mt-1 w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-text outline-none focus:border-lime/60"
        value={value.damageNotes} onChange={event => onChange({ ...value, damageNotes: event.target.value })} />
    </label>
    <label className="flex items-center gap-2 border-t border-border pt-3 text-sm text-text">
      <input type="checkbox" className="accent-lime" checked={value.inspection.approved}
        disabled={disabled || value.damaged || !inspectionChecksComplete(value.inspection)}
        onChange={event => onChange({ ...value, inspection: { ...value.inspection, approved: event.target.checked } })} />
      Vehicle condition approved
    </label>
    <p className="text-xs text-muted">Complete the basic checks and add notes for any issues. Approve the condition when no damage needs review.</p>
  </fieldset>;
}
