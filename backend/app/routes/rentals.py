from datetime import date, datetime, time

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.odoo_client import odoo
from app.verticals.car_rental.crm_journey import sync_order
from app.core.record_metadata import write_metadata
from app.verticals.car_rental.eligibility import fleet_eligibility
from app.routes.calendar import QUOTATION_TAG, booking_status, rental_vehicle_id
from app.routes.cars import RETURNED_TAG
from app.verticals.car_rental.states import blocking_booking_domain, is_booking_state, is_operational_state


router = APIRouter(
    prefix="/rentals",
    tags=["Rentals"],
)


def is_vehicle_available(state_label: str | None) -> bool:
    """
    Same rented/available classification used by lib/status.ts
    on the frontend, kept in sync manually. Handles both the
    French Odoo status labels ('Disponible', 'Loué') and English
    equivalents.
    """

    raw = (state_label or "").lower().strip()

    return not any(word in raw for word in ("indispon", "unavailable")) and ("disponible" in raw or "available" in raw)


# ============================================================
# TYPES
# ============================================================

class RentalProductLine(BaseModel):
    """
    One product added to a rental.

    A rental can contain multiple product lines:
    - Economy Car
    - Chauffeur
    - Baby Seat
    - Deposit
    - GPS
    - Insurance
    - etc.
    """

    product_id: int
    line_id: int | None = None
    discount_percent: float = Field(default=0, ge=0, le=100, allow_inf_nan=False)

    quantity: float = Field(
        default=1,
        gt=0,
        allow_inf_nan=False,
    )

    unit_price: float | None = Field(
        default=None,
        ge=0,
        allow_inf_nan=False,
    )


class RentalCreate(BaseModel):
    """
    Create a rental/order.

    One customer can have unlimited rentals/orders.
    One rental can contain multiple Odoo products.
    """
    
    partner_id: int

    vehicle_id: int

    start_date: date
    start_time: time | None = None

    end_date: date
    end_time: time | None = None
    pickup_location: str | None = Field(default=None, max_length=250)
    return_location: str | None = Field(default=None, max_length=250)

    products: list[RentalProductLine] = Field(
        min_length=1,
    )

    # Optional CRM opportunity / lead.
    opportunity_id: int | None = None


# ============================================================
# HELPERS
# ============================================================

def get_record(
    model: str,
    record_id: int,
    fields: list[str],
):
    records = odoo.execute(
        model,
        "search_read",
        [
            [
                ["id", "=", record_id],
            ]
        ],
        {
            "fields": fields,
            "limit": 1,
        },
    )

    if not records:
        raise HTTPException(
            status_code=404,
            detail=(
                f"{model} record "
                f"{record_id} was not found."
            ),
        )

    return records[0]


# ============================================================
# RENTAL OPTIONS
# ============================================================

@router.get("/options")
def get_rental_options(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    exclude_order_id: int | None = None,
):
    """
    Return the Odoo-backed choices required by
    the New Rental interface.

    Source of truth:

        Customers
            ↓
        res.partner

        Vehicles
            ↓
        fleet.vehicle

        Products
            ↓
        product.product

    Product suggestions are returned as product IDs.

    The suggestion relationship will ultimately be
    driven by the Odoo product configuration.

    When start_date/end_date are both provided, each
    vehicle also gets an `available` flag: its fleet
    status must be "available" (reusing the same
    classifier as Analytics) AND it must not already be
    booked over that date range (reusing the same
    note-parsing convention as the Calendar endpoint,
    since that's where vehicle<->rental linkage lives).
    """

    # ========================================================
    # CUSTOMERS
    # ========================================================

    customers = odoo.execute(
        "res.partner",
        "search_read",
        [
            [
                ["active", "=", True],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
            ],
            "order": "name",
            "limit": 500,
        },
    )

    # ========================================================
    # VEHICLES
    # ========================================================

    vehicles = odoo.execute(
        "fleet.vehicle",
        "search_read",
        [
            [
                ["active", "=", True],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "license_plate",
                "state_id",
                "category_id",
                "brand_id",
                "location",
            ],
            "order": "name",
            "limit": 500,
        },
    )

    # ------------------------------------------------------
    # BOOKED VEHICLES FOR THE REQUESTED DATE RANGE
    #
    # Reuses the exact overlap query and note-parsing
    # convention already established in calendar.py, rather
    # than inventing a second way to find "which vehicle is
    # this order for."
    # ------------------------------------------------------

    booked_vehicle_ids: set[int] = set()

    if start_date and end_date and end_date >= start_date:
        overlapping_orders = odoo.execute(
            "sale.order",
            "search_read",
            [blocking_booking_domain(start_date, end_date, exclude_order_id)],
            {"fields": ["id", "note", "state"]},
        )

        for order in overlapping_orders:
            if order["id"] == exclude_order_id or booking_status(order) != "confirmed" or RETURNED_TAG in (order.get("note") or ""):
                continue
            vehicle_id = rental_vehicle_id(order.get("note"))

            if vehicle_id:
                booked_vehicle_ids.add(vehicle_id)

    editing_vehicle_id = None
    if exclude_order_id:
        editing_vehicle_id = rental_vehicle_id(get_record("sale.order", exclude_order_id, ["note"]).get("note"))

    eligibility = fleet_eligibility([vehicle["id"] for vehicle in vehicles], end_date)
    for vehicle in vehicles:
        state_id = vehicle.get("state_id")
        state_label = state_id[1] if isinstance(state_id, list) else None

        category_id = vehicle.get("category_id")
        brand_id = vehicle.get("brand_id")

        vehicle["category"] = (
            {"id": category_id[0], "name": category_id[1]}
            if isinstance(category_id, list)
            else None
        )

        vehicle["brand"] = (
            {"id": brand_id[0], "name": brand_id[1]}
            if isinstance(brand_id, list)
            else None
        )

        is_fleet_available = is_vehicle_available(state_label) or is_booking_state(state_label)
        if vehicle["id"] == editing_vehicle_id and not is_operational_state(state_label) and not any(word in (state_label or "").lower() for word in ("indispon", "unavailable")):
            is_fleet_available = True

        vehicle["available"] = (
            is_fleet_available
            and eligibility[vehicle["id"]]["eligible"]
            and vehicle["id"] not in booked_vehicle_ids
        )

        vehicle.update(eligibility[vehicle["id"]])
        # Raw Odoo fields no longer needed once derived above.
        del vehicle["category_id"]
        del vehicle["brand_id"]

    # ========================================================
    # PRODUCTS
    # ========================================================

    products = odoo.execute(
        "product.product",
        "search_read",
        [
            [
                ["active", "=", True],
                ["sale_ok", "=", True],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "display_name",
                "lst_price",
                "default_code",
            ],
            "order": "name",
            "limit": 500,
        },
    )

    # References are the agency's explicit rule: OPT extras, DEP deposits, LOC rentals.
    if len(products) == 500:
        extras = odoo.execute("product.product", "search_read", [[["active", "=", True], ["sale_ok", "=", True],
            ["default_code", "=ilike", "OPT-%"]]], {"fields": ["id", "name", "display_name", "lst_price", "default_code"], "order": "name"})
        known = {product["id"] for product in products}
        products.extend(product for product in extras if product["id"] not in known)
    extra_ids = {product["id"] for product in products
                 if (product.get("default_code") or "").strip().upper().startswith("OPT-")}

    # ========================================================
    # RESPONSE
    # ========================================================

    return {
        "customers": [
            {
                "id": customer["id"],
                "name": customer["name"],
            }
            for customer in customers
        ],

        "vehicles": [
            {
                "id": vehicle["id"],
                "name": vehicle["name"],
                "license_plate": vehicle.get(
                    "license_plate"
                ),
                "status": (
                    vehicle["state_id"][1]
                    if vehicle.get("state_id")
                    else None
                ),
                "category": vehicle.get("category"),
                "brand": vehicle.get("brand"),
                "available": vehicle.get("available", True),
                "blocking_reasons": vehicle.get("blocking_reasons", []),
                "location": vehicle.get("location") or "",
            }
            for vehicle in vehicles
        ],

        "products": [
            {
                "id": product["id"],

                "name": (
                    product.get("display_name")
                    or product["name"]
                ),

                "list_price": (
                    product.get("lst_price")
                    or 0
                ),

                "reference": product.get("default_code"),

                "is_deposit": (
                    product.get("default_code") or ""
                ).strip().upper().startswith("DEP-"),

                "suggested_product_ids": sorted(extra_ids - {product["id"]}),
            }

            for product in products
        ],
    }


# ============================================================
# CREATE RENTAL
# ============================================================

@router.post("")
def create_rental(
    rental: RentalCreate,
):
    """
    Create a rental as an Odoo sale.order.

    Structure:

        CRM opportunity
              ↓
        Sale Order
              ↓
        Customer
              ↓
        Rental dates
              ↓
        Fleet vehicle
              ↓
        Multiple Odoo products
              ↓
        Calendar

    Odoo remains the commercial source of truth.
    """

    # ========================================================
    # DATE VALIDATION
    # ========================================================
  
    pickup_at = datetime.combine(
        rental.start_date,
        rental.start_time or time.min,
    )

    return_at = datetime.combine(
        rental.end_date,
        rental.end_time or time.min,
    )

    if (
        rental.start_date < date.today()
        or return_at <= pickup_at
    ):
        raise HTTPException(
            status_code=422,
            detail="Pickup cannot be in the past; return must be after pickup.",
        )

    # ========================================================
    # PRODUCT VALIDATION
    # ========================================================

    if not rental.products:
        raise HTTPException(
            status_code=422,
            detail=(
                "At least one product must be "
                "added to the rental."
            ),
        )

    # ========================================================
    # CUSTOMER
    # ========================================================

    customer = get_record(
        "res.partner",
        rental.partner_id,
        [
            "id",
            "name",
        ],
    )

    # ========================================================
    # VEHICLE
    # ========================================================

    vehicle = get_record(
        "fleet.vehicle",
        rental.vehicle_id,
        [
            "id",
            "name",
            "license_plate",
            "active",
            "state_id",
            "location",
        ],
    )

    if not vehicle.get("active"):
        raise HTTPException(
            status_code=422,
            detail=(
                "The selected vehicle "
                "is inactive."
            ),
        )

    # ========================================================
    # CRM OPPORTUNITY
    # ========================================================

    opportunity = None

    if rental.opportunity_id is not None:

        opportunity = get_record(
            "crm.lead",
            rental.opportunity_id,
            [
                "id",
                "name",
                "partner_id",
                "type",
                "active",
            ],
        )

        opportunity_partner_id = None

        if opportunity.get("partner_id"):
            opportunity_partner_id = (
                opportunity["partner_id"][0]
            )

        if (
            opportunity_partner_id is not None
            and opportunity_partner_id
            != customer["id"]
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    "The selected CRM opportunity "
                    "does not belong to the "
                    "selected customer."
                ),
            )

    # ========================================================
    # VEHICLE LABEL
    # ========================================================

    vehicle_label = vehicle["name"]

    if vehicle.get("license_plate"):
        vehicle_label = (
            f"{vehicle_label} "
            f"({vehicle['license_plate']})"
        )

    # ========================================================
    # PRODUCT LINES
    # ========================================================

    order_lines = []

    validated_products = []

    for product_line in rental.products:

        product = get_record(
            "product.product",
            product_line.product_id,
            [
                "id",
                "name",
                "display_name",
                "sale_ok",
                "active",
                "lst_price",
            ],
        )

        if not product.get("active"):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Product "
                    f"{product_line.product_id} "
                    "is inactive."
                ),
            )

        if not product.get("sale_ok"):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Product "
                    f"{product_line.product_id} "
                    "is not available for sale."
                ),
            )

        line_values = {
            "product_id": product["id"],
            "discount": product_line.discount_percent,
            "product_uom_qty": (
                product_line.quantity
            ),
        }

        if product_line.unit_price is not None:
            line_values["price_unit"] = (
                product_line.unit_price
            )

        order_lines.append(
            (
                0,
                0,
                line_values,
            )
        )

        validated_products.append(
            {
                "id": product["id"],
                "name": (
                    product.get("display_name")
                    or product["name"]
                ),
                "quantity": (
                    product_line.quantity
                ),
                "unit_price": (
                    product_line.unit_price
                    if product_line.unit_price
                    is not None
                    else product.get(
                        "lst_price"
                    ) or 0
                ),
            }
        )

    # ========================================================
    # SALE ORDER VALUES
    # ========================================================

    if opportunity is None:
        lead_id = odoo.execute("crm.lead", "create", [{
            "name": f"{customer['name']} — {rental.start_date.isoformat()}",
            "partner_id": customer["id"], "type": "opportunity",
        }])
        opportunity = {"id": lead_id}

    sale_values = {
        "partner_id": customer["id"],

        "date_order": pickup_at.strftime("%Y-%m-%d %H:%M:%S"),
        "commitment_date": return_at.strftime("%Y-%m-%d %H:%M:%S"),

        "note": (
            f"{QUOTATION_TAG}\n"
            f"[Rental OS "
            f"fleet.vehicle:{vehicle['id']}]"
            "\n"
            f"Rental vehicle: "
            f"{vehicle_label}"
        ),

        "order_line": order_lines,
    }

    # ========================================================
    # LINK CRM OPPORTUNITY
    # ========================================================

    sale_values["note"] = write_metadata(sale_values["note"], "rental_logistics", {
        "pickup_location": (rental.pickup_location if rental.pickup_location is not None else vehicle.get("location") or "").strip(),
        "return_location": (rental.return_location if rental.return_location is not None else vehicle.get("location") or "").strip(),
    })
    if opportunity is not None:
        sale_values[
            "opportunity_id"
        ] = opportunity["id"]

    # ========================================================
    # CREATE ODOO SALE ORDER
    # ========================================================

    sale_id = odoo.execute(
        "sale.order",
        "create",
        [sale_values],
    )

    # ========================================================
    # SYNC FLEET STATE
    #
    # A booking should reserve the vehicle the moment it
    # exists, not only once confirmed — see cars.py for the
    # full state logic. Non-fatal: if this fails, the rental
    # itself still succeeded, and /cars/sync can catch up later.
    # ========================================================

    # Draft quotations do not reserve the fleet.

    # ========================================================
    # READ CREATED SALE
    # ========================================================

    sale = get_record(
        "sale.order",
        sale_id,
        [
            "id",
            "name",
            "partner_id",
            "state",
            "date_order",
            "commitment_date",
            "amount_total",
            "invoice_status",
            "opportunity_id",
            "order_line",
            "note",
        ],
    )

    # ========================================================
    # RESPONSE
    # ========================================================

    return {
        "success": True,
        **sync_order(sale),
        "sale": {
            "id": sale["id"],

            "name": sale["name"],

            "customer": (
                {
                    "id": sale[
                        "partner_id"
                    ][0],

                    "name": sale[
                        "partner_id"
                    ][1],
                }

                if sale.get(
                    "partner_id"
                )

                else None
            ),

            "state": sale["state"],

            "date_order": sale.get(
                "date_order"
            ),

            "commitment_date": sale.get(
                "commitment_date"
            ),

            "amount_total": (
                sale.get(
                    "amount_total"
                ) or 0
            ),

            "invoice_status": (
                sale.get(
                    "invoice_status"
                )
            ),

            "opportunity": (
                {
                    "id": sale[
                        "opportunity_id"
                    ][0],

                    "name": sale[
                        "opportunity_id"
                    ][1],
                }

                if sale.get(
                    "opportunity_id"
                )

                else None
            ),

            "order_line_ids": (
                sale.get(
                    "order_line"
                ) or []
            ),

            "vehicle_id": vehicle[
                "id"
            ],

            "vehicle_name": vehicle_label,

            "vehicle_status": (
                vehicle[
                    "state_id"
                ][1]

                if vehicle.get(
                    "state_id"
                )

                else None
            ),

            "products": validated_products,
        },
    }
