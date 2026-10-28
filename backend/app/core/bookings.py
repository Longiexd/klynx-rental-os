"""Booking confirmation policy shared by calendar and business modules."""
QUOTATION_TAG = "[Rental OS booking:quotation]"
CONFIRMED_TAG = "[Rental OS booking:confirmed]"


def booking_status(order: dict) -> str:
    if order.get("state") == "cancel":
        return "cancelled"
    if QUOTATION_TAG in (order.get("note") or ""):
        return "quotation"
    # Preserve confirmed orders created before the explicit booking tags existed.
    return "confirmed" if order.get("state") in ("sale", "done") else "quotation"
