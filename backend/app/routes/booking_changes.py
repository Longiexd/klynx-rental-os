"""Booking edits reuse the existing sale-order and fleet links in Odoo."""
import re
import math
import logging
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, HTTPException

from app.odoo_client import odoo
from app.core.record_metadata import read_metadata, write_metadata
from app.verticals.car_rental.contracts import ensure_pickup_paperwork
from app.routes.calendar import CONFIRMED_TAG, QUOTATION_TAG, booking_status, rental_vehicle_id
from app.routes.cars import PICKED_UP_TAG, RETURNED_TAG, sync_vehicle_state
from app.routes.rentals import RentalCreate, get_record
from app.verticals.car_rental.states import is_operational_state, blocking_booking_domain
from app.verticals.car_rental.eligibility import ensure_eligible
from app.verticals.car_rental.crm_journey import sync_order

router = APIRouter(prefix="/rentals", tags=["Rentals"])
logger = logging.getLogger(__name__)


def ensure_available(vehicle_id, start, end, order_id):
    ensure_eligible(vehicle_id, end)
    vehicle = get_record("fleet.vehicle", vehicle_id, ["active", "state_id"])
    label = vehicle["state_id"][1] if vehicle.get("state_id") else ""
    if not vehicle.get("active") or is_operational_state(label) or any(word in label.lower() for word in ("indispon", "unavailable")):
        raise HTTPException(409, "The vehicle is not operationally available. Review Fleet before confirmation.")
    orders = odoo.execute("sale.order", "search_read",
                         [blocking_booking_domain(start, end, order_id)],
                         {"fields": ["note", "state"]})
    if any(rental_vehicle_id(row.get("note")) == vehicle_id and booking_status(row) == "confirmed"
           and RETURNED_TAG not in (row.get("note") or "") for row in orders):
        raise HTTPException(409, "This vehicle already has a confirmed booking for these dates. Choose another vehicle or dates.")


def refresh_fleet(vehicle_id):
    if vehicle_id:
        return sync_vehicle_state(vehicle_id)


@router.patch("/{order_id}")
def update_booking(order_id: int, rental: RentalCreate):
    order = get_record("sale.order", order_id, ["state", "note", "partner_id", "date_order", "commitment_date", "locked", "opportunity_id"])
    if order["state"] not in ("draft", "sent", "sale") or order.get("locked") or RETURNED_TAG in (order.get("note") or ""):
        raise HTTPException(409, "This booking is cancelled, returned or locked.")
    original_start = (order.get("date_order") or "")[:10]
    pickup_time = rental.start_time or (datetime.fromisoformat(order["date_order"]).time()
                                       if order.get("date_order") else time.min)
    return_time = rental.end_time or (datetime.fromisoformat(order["commitment_date"]).time()
                                     if order.get("commitment_date") else time.min)
    pickup_at = datetime.combine(rental.start_date, pickup_time)
    return_at = datetime.combine(rental.end_date, return_time)
    if return_at <= pickup_at or (rental.start_date < date.today() and rental.start_date.isoformat() != original_start):
        raise HTTPException(422, "Pickup cannot move into the past; return must be after pickup.")
    if rental.partner_id != order["partner_id"][0]:
        raise HTTPException(409, "Keep the original customer when editing this booking.")
    vehicle = get_record("fleet.vehicle", rental.vehicle_id, ["active"])
    if not vehicle.get("active"):
        raise HTTPException(422, "The selected vehicle is inactive.")
    if PICKED_UP_TAG in (order.get("note") or "") and rental.vehicle_id != rental_vehicle_id(order.get("note")):
        raise HTTPException(409, "A vehicle already handed over cannot be replaced through a booking edit.")
    if booking_status(order) == "confirmed":
        ensure_available(rental.vehicle_id, rental.start_date, rental.end_date, order_id)
    lines = odoo.execute("sale.order.line", "search_read", [[["order_id", "=", order_id]]], {
        "fields": ["product_id", "product_uom_qty", "price_unit", "discount", "qty_invoiced", "qty_delivered", "display_type", "is_downpayment"],
    })
    existing = {line["id"]: line for line in lines if not line.get("display_type") and not line.get("is_downpayment")}
    commands, seen = [], set()
    for item in rental.products:
        values = {"product_id": item.product_id, "product_uom_qty": item.quantity, "discount": item.discount_percent}
        if item.unit_price is not None:
            values["price_unit"] = item.unit_price
        if item.line_id:
            line = existing.get(item.line_id)
            if not line or item.line_id in seen:
                raise HTTPException(422, "An article is duplicated or does not belong to this quotation.")
            seen.add(item.line_id)
            changes = {key: value for key, value in values.items() if value != (line[key][0] if key == "product_id" else line[key])}
            if changes and (line.get("qty_invoiced") or line.get("qty_delivered")):
                raise HTTPException(409, "Invoiced or delivered articles must be adjusted through accounting; add new articles separately.")
            if changes:
                commands.append((1, item.line_id, changes))
        else:
            product = get_record("product.product", item.product_id, ["active", "sale_ok"])
            if not product.get("active") or not product.get("sale_ok"):
                raise HTTPException(422, "This product is not available for sale.")
            commands.append((0, 0, values))
    for line_id, line in existing.items():
        if line_id not in seen:
            if line.get("qty_invoiced") or line.get("qty_delivered"):
                raise HTTPException(409, "An invoiced or delivered article cannot be removed.")
            commands.append((1, line_id, {"product_uom_qty": 0}) if order["state"] == "sale" else (2, line_id, 0))
    old_vehicle = rental_vehicle_id(order.get("note"))
    note = re.sub(r"\[Rental OS fleet\.vehicle:\d+\]", f"[Rental OS fleet.vehicle:{rental.vehicle_id}]", order.get("note") or "")
    if old_vehicle is None:
        note += f"\n[Rental OS fleet.vehicle:{rental.vehicle_id}]"
    logistics = read_metadata(note, "rental_logistics") or {}
    for key in ("pickup_location", "return_location"):
        value = getattr(rental, key)
        if value is not None:
            logistics[key] = value.strip()
    if logistics:
        note = write_metadata(note, "rental_logistics", logistics)
    odoo.execute("sale.order", "write", [[order_id], {
        "date_order": pickup_at.strftime("%Y-%m-%d %H:%M:%S"),
        "commitment_date": return_at.strftime("%Y-%m-%d %H:%M:%S"), "note": note, "order_line": commands,
    }])
    if booking_status(order) == "confirmed":
        for vehicle_id in {old_vehicle, rental.vehicle_id}:
            refresh_fleet(vehicle_id)
    return {"sale": {"id": order_id}, "success": True, **sync_order(order)}


@router.post("/{order_id}/confirm")
def confirm_booking(order_id: int):
    order = get_record("sale.order", order_id, ["state", "note", "invoice_ids", "date_order", "commitment_date", "amount_total", "opportunity_id"])
    if booking_status(order) == "confirmed":
        return {"booking_status": "confirmed", **sync_order(order)}
    if order["state"] not in ("sale", "done"):
        raise HTTPException(409, "Confirm the quotation, create an invoice and record a payment first.")
    invoices = odoo.execute("account.move", "search_read", [[
        ["id", "in", order.get("invoice_ids") or []], ["state", "=", "posted"],
        ["move_type", "in", ["out_invoice", "out_refund"]],
    ]], {"fields": ["amount_total", "amount_residual", "move_type"]})
    paid = sum((row["amount_total"] - row["amount_residual"]) * (-1 if row["move_type"] == "out_refund" else 1) for row in invoices)
    if paid <= 0:
        raise HTTPException(409, "Record a partial or full payment before confirming this booking.")
    vehicle_id = rental_vehicle_id(order.get("note"))
    if not vehicle_id or not order.get("date_order") or not order.get("commitment_date"):
        raise HTTPException(409, "Choose a vehicle and pickup/return dates first.")
    ensure_available(vehicle_id, date.fromisoformat(order["date_order"][:10]), date.fromisoformat(order["commitment_date"][:10]), order_id)
    note = (order.get("note") or "").replace(QUOTATION_TAG, "")
    if not odoo.execute("sale.order", "write", [[order_id], {"note": f"{note}\n{CONFIRMED_TAG}"}]):
        raise HTTPException(502, "Booking confirmation could not be saved.")
    refresh_fleet(vehicle_id)
    return {"booking_status": "confirmed", **sync_order(order)}


@router.post("/{order_id}/picked-up")
def mark_picked_up(order_id: int):
    """Records that the customer actually collected the vehicle today."""
    order = get_record("sale.order", order_id, ["state", "note", "date_order", "commitment_date", "opportunity_id"])
    if RETURNED_TAG in (order.get("note") or ""):
        raise HTTPException(409, "A returned booking cannot be picked up again.")
    if booking_status(order) != "confirmed":
        raise HTTPException(409, "Only a confirmed booking can be marked as picked up.")
    vehicle_id = rental_vehicle_id(order.get("note"))
    if not vehicle_id:
        raise HTTPException(409, "Choose a vehicle before confirming pickup.")
    if PICKED_UP_TAG in (order.get("note") or ""):
        refresh_fleet(vehicle_id)
        return {"success": True, "already": True, **sync_order(order)}
    if not order.get("date_order") or order["date_order"][:10] > date.today().isoformat():
        raise HTTPException(409, "Pickup is not due yet. Update the booking dates first.")
    vehicle = get_record("fleet.vehicle", vehicle_id, ["active", "state_id", "odometer", "odometer_unit"])
    state = vehicle.get("state_id")
    if not vehicle.get("active") or is_operational_state(state[1] if state else None):
        raise HTTPException(409, "Finish vehicle cleaning or maintenance and mark it available before pickup.")
    ensure_eligible(vehicle_id, date.fromisoformat(order["commitment_date"][:10]) if order.get("commitment_date") else None)
    if state and any(word in state[1].lower() for word in ("indispon", "unavailable")):
        raise HTTPException(409, "Vehicle unavailable. Review Fleet before pickup.")
    linked_order = order
    order = ensure_pickup_paperwork(order_id)
    note = f"{(order.get('note') or '')}\n{PICKED_UP_TAG}".strip()
    reading = vehicle.get("odometer")
    unit = vehicle.get("odometer_unit")
    if isinstance(reading, (int, float)) and not isinstance(reading, bool) and math.isfinite(reading) and reading >= 0 and unit in ("kilometers", "miles"):
        note = write_metadata(note, "rental_pickup", {"order_id": order_id, "vehicle_id": vehicle_id,
            "odometer": reading, "odometer_unit": unit, "picked_up_at": datetime.now(timezone.utc).isoformat()})
    if not odoo.execute("sale.order", "write", [[order_id], {"note": note}]):
        raise HTTPException(502, "Pickup could not be saved. Refresh before retrying.")
    refresh_fleet(vehicle_id)
    return {"success": True, **sync_order(linked_order)}


@router.post("/{order_id}/cancel")
def cancel_booking(order_id: int):
    order = get_record("sale.order", order_id, ["state", "note", "opportunity_id", "locked"])
    if order["state"] == "cancel":
        return {"booking_status": "cancelled", "message": "Already cancelled."}
    if order.get("locked"):
        raise HTTPException(409, "This booking is locked and cannot be cancelled from here.")
    try:
        odoo.execute("sale.order", "action_cancel", [[order_id]], {"context": {"disable_cancel_warning": True}})
    except HTTPException:
        raise
    except Exception:
        logger.warning("Booking cancellation failed (order %s)", order_id)
        raise HTTPException(502, "Company service could not complete the cancellation.") from None
    lead_lost = True
    if order.get("opportunity_id"):
        try:
            odoo.execute("crm.lead", "action_set_lost", [[order["opportunity_id"][0]]])
        except Exception:
            # The sales order is already cancelled at this point; don't
            # fail the whole request just because the linked lead
            # couldn't also be marked lost (e.g. it was already won/lost).
            lead_lost = False
            logger.warning("Linked lead could not be marked lost (order %s)", order_id)
    refresh_fleet(rental_vehicle_id(order.get("note")))
    return {"booking_status": "cancelled", "lead_marked_lost": lead_lost,
            "message": "Cancelled. Existing posted invoices/payments remain on record; process any refund separately."}
