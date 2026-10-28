export type FleetBooking = {
  id: number;
  vehicle_id?: number | null;
  state: string;
  booking_status?: "quotation" | "confirmed" | "cancelled";
  picked_up?: boolean;
  returned?: boolean;
  date_order: string | null;
  commitment_date: string | null;
};

function isQuotation(sale: FleetBooking) {
  return sale.booking_status === "quotation" || sale.state === "draft" || sale.state === "sent";
}

export function getVehicleBookings<T extends FleetBooking>(vehicleId: number, sales: T[], now = new Date()) {
  const relevant = sales.filter(sale => sale.vehicle_id === vehicleId &&
    sale.state !== "cancel" && sale.booking_status !== "cancelled" && !sale.returned);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  function priority(sale: T) {
    const start = sale.date_order?.slice(0, 10);
    const end = sale.commitment_date?.slice(0, 10);
    if (end && end < today) return 0;
    if (sale.picked_up) return 1;
    if (start && end && start <= today && today <= end) return 2;
    return start && start > today ? 3 : 4;
  }
  const confirmed = relevant.filter(sale => !isQuotation(sale) &&
    (sale.booking_status === "confirmed" || sale.state === "sale" || sale.state === "done"));
  confirmed.sort((a, b) => priority(a) - priority(b) ||
    (a.date_order || "").localeCompare(b.date_order || "") || a.id - b.id);
  const quotations = relevant.filter(isQuotation).sort((a, b) =>
    (a.date_order || "").localeCompare(b.date_order || "") || a.id - b.id);
  return { rental: confirmed[0] || null, quotations };
}

export type NextVehicleState = "Nettoyage" | "Disponible" | "Maintenance";
export type ReturnInspection = {
  body_checked: boolean;
  interior_checked: boolean;
  fuel_keys_checked: boolean;
  approved: boolean;
};
export type ReturnConditionForm = {
  inspection: ReturnInspection;
  damaged: boolean;
  damageNotes: string;
};

export function emptyReturnInspection(): ReturnInspection {
  return { body_checked: false, interior_checked: false, fuel_keys_checked: false, approved: false };
}

export function inspectionChecksComplete(inspection: ReturnInspection) {
  return inspection.body_checked && inspection.interior_checked && inspection.fuel_keys_checked;
}

export type ReturnRecord = {
  status: "pending" | "completed";
  order_id: number;
  vehicle_id: number;
  returned_at: string;
  odometer: number | null;
  previous_odometer: number;
  odometer_unit: "kilometers" | "miles";
  next_state: NextVehicleState;
  return_notes: string;
  damage_notes: string;
  inspection?: ReturnInspection | null;
  damaged?: boolean;
};
export type ReturnForm = {
  orderId: string; odometer: string; nextState: NextVehicleState;
  returnNotes: string; damageNotes: string;
  inspection?: ReturnInspection;
  damaged?: boolean;
};

export function odometerUnit(unit: string | null | undefined) {
  return unit === "miles" ? "mi" : "km";
}

export function buildReturnPayload(form: ReturnForm, currentOdometer: number, pending?: ReturnRecord | null) {
  const orderId = Number(form.orderId);
  const odometer = Number(form.odometer);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new Error("Choose the booking to return.");
  if (!Number.isFinite(currentOdometer) || currentOdometer < 0) throw new Error("The saved odometer reading is invalid. Refresh the vehicle.");
  if (pending) {
    if (pending.status !== "pending" || pending.order_id !== orderId) throw new Error("Refresh the saved return details.");
    if (pending.odometer !== null && (!Number.isFinite(pending.odometer) || pending.odometer < currentOdometer)) {
      throw new Error("The vehicle's reading has changed since this return. Review it before retrying.");
    }
    return { order_id: orderId, odometer: pending.odometer, next_state: pending.next_state,
      return_notes: pending.return_notes, damage_notes: pending.damage_notes,
      ...(pending.inspection !== undefined ? { inspection: pending.inspection } : {}),
      ...(pending.damaged !== undefined ? { damaged: pending.damaged } : {}) };
  }
  if (!form.odometer.trim() || !Number.isFinite(odometer) || odometer < 0) {
    throw new Error("Enter the vehicle's current odometer reading.");
  }
  if (odometer < currentOdometer) throw new Error(`Odometer cannot be below the saved reading (${currentOdometer}).`);
  if (!["Nettoyage", "Disponible", "Maintenance"].includes(form.nextState)) throw new Error("Choose the vehicle's next state.");
  if (form.returnNotes.length > 4000 || form.damageNotes.length > 4000) throw new Error("Keep each note within 4,000 characters.");
  if (form.damaged && !form.damageNotes.trim()) throw new Error("Describe the vehicle damage before saving.");
  if (form.damaged && form.nextState === "Disponible") throw new Error("A damaged vehicle must be checked before it can be available.");
  if (form.inspection?.approved && (!inspectionChecksComplete(form.inspection) || form.damaged)) {
    throw new Error("Complete the basic checks and resolve damage before approving the vehicle condition.");
  }
  return { order_id: orderId, odometer, next_state: form.nextState,
    return_notes: form.returnNotes.trim(), damage_notes: form.damageNotes.trim(),
    ...(form.inspection !== undefined ? { inspection: form.inspection } : {}),
    ...(form.damaged !== undefined ? { damaged: form.damaged } : {}) };
}
