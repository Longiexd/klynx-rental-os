from datetime import date, timedelta

from fastapi import APIRouter, Query

from app.odoo_client import odoo
from app.core.bookings import QUOTATION_TAG, CONFIRMED_TAG, booking_status
from app.verticals.car_rental.states import rental_vehicle_id

router = APIRouter(
    prefix="/calendar",
    tags=["Calendar"],
)

def many2one(value):
    if isinstance(value, list) and len(value) >= 2:
        return {"id": value[0], "name": value[1]}
    return None


@router.get("")
def get_calendar(
    start: date = Query(...),
    end: date = Query(...),
):
    if end < start:
        return {
            "count": 0,
            "rentals": [],
        }

    end_exclusive = end + timedelta(days=1)

    orders = odoo.execute(
        "sale.order",
        "search_read",
        [
            [
                ["date_order", "<", f"{end_exclusive.isoformat()} 00:00:00"],
                [
                    "commitment_date",
                    ">=",
                    f"{start.isoformat()} 00:00:00",
                ],
                ["state", "!=", "cancel"],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "partner_id",
                "state",
                "date_order",
                "commitment_date",
                "amount_total",
                "invoice_status",
                "opportunity_id",
                "note",
            ],
            "order": "date_order asc",
            "limit": 2000,
        },
    )

    vehicle_ids = {
        vehicle_id
        for vehicle_id in (
            rental_vehicle_id(order.get("note"))
            for order in orders
        )
        if vehicle_id is not None
    }

    vehicles = []

    if vehicle_ids:
        vehicles = odoo.execute(
            "fleet.vehicle",
            "search_read",
            [
                [
                    ["id", "in", list(vehicle_ids)],
                ]
            ],
            {
                "fields": [
                    "id",
                    "name",
                    "license_plate",
                    "state_id",
                    "active",
                ],
                "limit": 2000,
            },
        )

    vehicle_map = {
        vehicle["id"]: vehicle
        for vehicle in vehicles
    }

    rentals = []

    for order in orders:
        vehicle_id = rental_vehicle_id(order.get("note"))
        vehicle = vehicle_map.get(vehicle_id) if vehicle_id else None

        rentals.append(
            {
                "id": order["id"],
                "name": order["name"],
                "customer": many2one(order.get("partner_id")),
                "state": order.get("state"),
                "booking_status": booking_status(order),
                "start_date": order.get("date_order"),
                "end_date": order.get("commitment_date"),
                "amount_total": order.get("amount_total") or 0,
                "invoice_status": order.get("invoice_status"),
                "opportunity": many2one(order.get("opportunity_id")),
                "vehicle": (
                    {
                        "id": vehicle["id"],
                        "name": vehicle["name"],
                        "license_plate": vehicle.get("license_plate"),
                        "status": (
                            vehicle["state_id"][1]
                            if vehicle.get("state_id")
                            else None
                        ),
                        "active": vehicle.get("active", True),
                    }
                    if vehicle
                    else None
                ),
            }
        )

    return {
        "count": len(rentals),
        "rentals": rentals,
    }
