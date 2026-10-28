"""Project existing rental milestones onto the linked native Odoo CRM opportunity."""
from unicodedata import normalize

from app.core.bookings import booking_status
from app.odoo_client import current_client, odoo
from app.verticals.car_rental.states import PICKED_UP_TAG, RETURNED_TAG, rental_vehicle_id

STAGES = {
    "new": ("Nouveau prospect", "New prospect", "New lead", "New"),
    "quotation": ("Devis envoyé", "Quotation sent"),
    "confirmed": ("Réservation confirmée", "Reservation confirmed", "Booking confirmed"),
    "documents": ("Documents",),
    "pickup": ("Véhicule remis", "Vehicle delivered", "Vehicle handed over"),
    "returned": ("Location terminée", "Rental completed"),
}
WARNING = "Saved, but CRM could not be synchronized. Open Prospects to retry and check the rental stages in Odoo."


def normalized(value):
    return " ".join(normalize("NFKD", value or "").encode("ascii", "ignore").decode().lower().split())


def milestone(order, documents_ready=False):
    if booking_status(order) == "cancelled":
        return None
    note = order.get("note") or ""
    if booking_status(order) != "confirmed":
        return "quotation"
    if RETURNED_TAG in note:
        return "returned"
    if PICKED_UP_TAG in note:
        return "pickup"
    return "documents" if documents_ready else "confirmed"


def stage_for(stages, key, team_id):
    names = {normalized(name) for name in STAGES[key]}
    matches = [stage for stage in stages if normalized(stage["name"]) in names]
    team = [stage for stage in matches if team_id and (stage.get("team_id") or [None])[0] == team_id]
    candidates = team or [stage for stage in matches if not stage.get("team_id")]
    preferred = [stage for stage in candidates if normalized(stage["name"]) == normalized(STAGES[key][0])]
    candidates = preferred or candidates
    return candidates[0]["id"] if len(candidates) == 1 else None


def latest_rentals(lead_ids):
    """The same opportunity-linked rental drives its CRM stage and navigation."""
    if not lead_ids:
        return {}
    orders = odoo.execute("sale.order", "search_read", [[
        ["opportunity_id", "in", lead_ids],
        ["note", "ilike", "[Rental OS fleet.vehicle:"],
    ]], {"fields": ["id", "name", "state", "note", "opportunity_id", "partner_id"], "order": "id desc"})
    latest = {}
    for order in orders:
        if order.get("opportunity_id") and rental_vehicle_id(order.get("note")):
            latest.setdefault(order["opportunity_id"][0], order)
    return latest


def synchronize(lead_ids=None, *, include_unbooked=False):
    """Reconcile visible opportunities; never reactivate lost leads or replay rental actions."""
    client = current_client.get()
    if client and client.profile.get("role") == "viewer":
        return {"crm_synced": 0}
    domain = [["active", "=", True]]
    if lead_ids is not None:
        if not lead_ids:
            return {"crm_synced": 0}
        domain.append(["id", "in", sorted(set(lead_ids))])
    leads = odoo.execute("crm.lead", "search_read", [domain],
                         {"fields": ["id", "stage_id", "team_id"]})
    if not leads:
        return {"crm_synced": 0}
    latest = latest_rentals([lead["id"] for lead in leads])
    if not latest and not include_unbooked:
        return {"crm_synced": 0}
    pending = [order for order in latest.values() if milestone(order) == "confirmed"]
    # Use the same verified-main/additional-driver rule as the rental paperwork panel.
    from app.verticals.car_rental.contracts import batch_paperwork
    paperwork = batch_paperwork(pending) if pending else {}
    stages = odoo.execute("crm.stage", "search_read", [], {"fields": ["id", "name", "team_id"]})
    changes, warning = {}, False
    for lead in leads:
        order = latest.get(lead["id"])
        key = milestone(order, paperwork.get(order["id"], {}).get("documents_ready", False)) if order else (
            "new" if include_unbooked else None)
        if key is None:
            continue
        stage_id = stage_for(stages, key, (lead.get("team_id") or [None])[0])
        if stage_id is None:
            warning = True
        elif stage_id != (lead.get("stage_id") or [None])[0]:
            changes.setdefault(stage_id, []).append(lead["id"])
    updated = 0
    for stage_id, ids in changes.items():
        try:
            if odoo.execute("crm.lead", "write", [ids, {"stage_id": stage_id}]):
                updated += len(ids)
            else:
                warning = True
        except Exception:
            warning = True
    return {"crm_synced": updated, **({"crm_warning": WARNING} if warning else {})}


def safe_sync(lead_ids=None, **kwargs):
    # Rental/document writes already succeeded. A CRM outage must not invite duplicate retries.
    try:
        return synchronize(lead_ids, **kwargs)
    except Exception:
        return {"crm_warning": WARNING}


def sync_order(order):
    opportunity = order.get("opportunity_id")
    return safe_sync([opportunity[0]]) if opportunity else {}


def order_documents_saved(order_id, *_):
    try:
        rows = odoo.execute("sale.order", "search_read", [[["id", "=", order_id]]],
                            {"fields": ["opportunity_id"], "limit": 1})
        return sync_order(rows[0]) if rows else {}
    except Exception:
        return {"crm_warning": WARNING}


def customer_documents_saved(partner_id, *_):
    try:
        rows = odoo.execute("sale.order", "search_read", [[
            ["partner_id", "=", partner_id], ["opportunity_id", "!=", False],
            ["note", "ilike", "[Rental OS fleet.vehicle:"],
        ]], {"fields": ["opportunity_id"]})
        ids = [row["opportunity_id"][0] for row in rows if row.get("opportunity_id")]
        return safe_sync(ids)
    except Exception:
        return {"crm_warning": WARNING}
