"""Small, read-only navigation search using the signed-in operator's Odoo rules."""
from fastapi import APIRouter, Query

from app.odoo_client import odoo
from app.verticals.car_rental.crm_journey import latest_rentals

router = APIRouter(prefix="/search", tags=["Search"])


@router.get("")
def search(q: str = Query(min_length=2, max_length=80)):
    query = q.strip()
    if len(query) < 2:
        return {"results": []}
    results = []
    orders = odoo.execute("sale.order", "search_read", [[
        ["note", "ilike", "[Rental OS fleet.vehicle:"], "|",
        ["name", "ilike", query], ["partner_id.name", "ilike", query],
    ]], {"fields": ["name", "partner_id"], "limit": 5, "order": "id desc"})
    for order in orders:
        results.append({"id": f"rental-{order['id']}", "kind": "Rental", "label": order["name"],
                        "description": (order.get("partner_id") or [None, ""])[1],
                        "href": f"/dashboard/rentals/{order['id']}"})
    vehicles = odoo.execute("fleet.vehicle", "search_read", [["|",
        ["name", "ilike", query], ["license_plate", "ilike", query],
    ]], {"fields": ["name", "license_plate"], "limit": 5, "order": "id desc"})
    for vehicle in vehicles:
        results.append({"id": f"vehicle-{vehicle['id']}", "kind": "Vehicle", "label": vehicle["name"],
                        "description": vehicle.get("license_plate") or "",
                        "href": f"/dashboard/fleet?vehicle={vehicle['id']}"})
    customers = odoo.execute("res.partner", "search_read", [["|", "|", "|",
        ["name", "ilike", query], ["phone", "ilike", query], ["mobile", "ilike", query], ["email", "ilike", query],
    ]], {"fields": ["name"], "limit": 5, "order": "name, id"})
    linked = odoo.execute("crm.lead", "search_read", [[
        ["partner_id", "in", [customer["id"] for customer in customers]],
    ]], {"fields": ["partner_id"]}) if customers else []
    customer_ids = {(lead.get("partner_id") or [None])[0] for lead in linked}
    for customer in customers:
        if customer["id"] in customer_ids:
            results.append({"id": f"customer-{customer['id']}", "kind": "Customer", "label": customer["name"],
                            "href": f"/dashboard/customers/{customer['id']}"})
    leads = odoo.execute("crm.lead", "search_read", [["|",
        ["name", "ilike", query], ["partner_id.name", "ilike", query],
    ]], {"fields": ["name", "stage_id"], "limit": 5, "order": "create_date desc, id desc"})
    rentals = latest_rentals([lead["id"] for lead in leads])
    for lead in leads:
        rental = rentals.get(lead["id"])
        results.append({"id": f"prospect-{lead['id']}", "kind": "Prospect", "label": lead["name"],
                        "description": (lead.get("stage_id") or [None, ""])[1],
                        "href": f"/dashboard/rentals/{rental['id']}" if rental else f"/crm/leads/{lead['id']}"})
    invoices = odoo.execute("account.move", "search_read", [[
        ["move_type", "in", ["out_invoice", "out_refund"]], "|",
        ["name", "ilike", query], ["invoice_origin", "ilike", query],
    ]], {"fields": ["name", "invoice_origin"], "limit": 5, "order": "id desc"})
    invoice_orders = odoo.execute("sale.order", "search_read", [[
        ["invoice_ids", "in", [invoice["id"] for invoice in invoices]],
        ["note", "ilike", "[Rental OS fleet.vehicle:"],
    ]], {"fields": ["name", "invoice_ids"], "order": "id desc"}) if invoices else []
    for invoice in invoices:
        order = next((row for row in invoice_orders if invoice["id"] in row["invoice_ids"]), None)
        if order:
            results.append({"id": f"invoice-{invoice['id']}", "kind": "Invoice", "label": invoice.get("name") or order["name"],
                            "description": order["name"], "href": f"/dashboard/rentals/{order['id']}#payments"})
    activities = odoo.execute("mail.activity", "search_read", [[
        ["res_model", "in", ["crm.lead", "sale.order"]], ["active", "=", True], "|",
        ["summary", "ilike", query], ["res_name", "ilike", query],
    ]], {"fields": ["summary", "res_model", "res_id", "res_name"], "limit": 5, "order": "date_deadline, id"})
    for activity in activities:
        base = "/dashboard/rentals" if activity["res_model"] == "sale.order" else "/crm/leads"
        results.append({"id": f"activity-{activity['id']}", "kind": "Activity", "label": activity.get("summary") or activity.get("res_name") or "Follow up",
                        "description": activity.get("res_name") or "", "href": f"{base}/{activity['res_id']}?activity={activity['id']}"})
    return {"results": results}
