"""Pure fleet policy; Odoo remains the source of booking and vehicle data."""
import unicodedata
import re
from datetime import date, timedelta

from app.core.bookings import booking_status

RETURNED_TAG = "[Rental OS returned]"
PICKED_UP_TAG = "[Rental OS picked up]"


def rental_vehicle_id(note: str | None) -> int | None:
    if not isinstance(note, str):
        return None
    match = re.search(r"\[Rental OS fleet\.vehicle:(\d+)\]", note)
    return int(match.group(1)) if match else None


def normalize_state(value: str | None) -> str:
    return unicodedata.normalize("NFKD", value or "").encode(
        "ascii", "ignore"
    ).decode().lower().strip()


def is_operational_state(value: str | None) -> bool:
    state = normalize_state(value)
    return any(word in state for word in (
        "nettoy", "cleaning", "maintenance", "entretien", "repair", "repar",
    )) or state == "clean"


def is_booking_state(value: str | None) -> bool:
    state = normalize_state(value)
    return any(word in state for word in (
        "reserv", "loue", "rented", "retour d", "return due", "overdue",
    ))


def is_active_booking(order: dict) -> bool:
    return (booking_status(order) == "confirmed"
            and RETURNED_TAG not in (order.get("note") or ""))


def booking_state(orders: list[dict], today: date | None = None) -> str | None:
    active = [order for order in orders if is_active_booking(order)]
    if not active:
        return None
    current_date = (today or date.today()).isoformat()
    if any(PICKED_UP_TAG in (order.get("note") or "") and (order.get("commitment_date") or "")[:10]
           and order["commitment_date"][:10] < current_date for order in active):
        return "Retour dû"
    if any(PICKED_UP_TAG in (order.get("note") or "") for order in active):
        return "Louée"
    return "Réservé"


def target_state(current: str | None, orders: list[dict]) -> str | None:
    if is_operational_state(current):
        return None
    derived = booking_state(orders)
    return derived or ("Disponible" if is_booking_state(current) else None)


def group_bookings(orders: list[dict]) -> dict[int, list[dict]]:
    result: dict[int, list[dict]] = {}
    for order in orders:
        vehicle_id = rental_vehicle_id(order.get("note"))
        if vehicle_id and is_active_booking(order):
            result.setdefault(vehicle_id, []).append(order)
    return result


def blocking_booking_domain(start: date, end: date, exclude_order_id: int | None = None) -> list:
    """Overlaps and overdue, unreturned rentals require an agent's decision."""
    domain = [
        ["state", "in", ["sale", "done"]],
        "|", "&",
        ["date_order", "<", f"{(end + timedelta(days=1)).isoformat()} 00:00:00"],
        ["commitment_date", ">=", f"{start.isoformat()} 00:00:00"],
        ["commitment_date", "<", f"{date.today().isoformat()} 00:00:00"],
    ]
    if exclude_order_id is not None:
        domain.append(["id", "!=", exclude_order_id])
    return domain
