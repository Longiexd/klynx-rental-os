from __future__ import annotations

import re
import math
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Query

from app.odoo_client import odoo
from app.core.record_metadata import read_metadata
from app.verticals.car_rental.deposits import is_security_deposit
from app.verticals.car_rental.eligibility import fleet_eligibility


router = APIRouter(
    prefix="/analytics",
    tags=["Analytics"],
)


VEHICLE_NOTE_RE = re.compile(
    r"\[Rental OS fleet\.vehicle:(\d+)\]"
)


def clean_number(value) -> float:
    try:
        number = float(value or 0)
        return number if math.isfinite(number) else 0.0
    except (TypeError, ValueError):
        return 0.0


def many2one_id(value):
    if isinstance(value, (list, tuple)) and value:
        return value[0]
    if isinstance(value, int):
        return value
    return None


def many2one_name(value):
    if isinstance(value, (list, tuple)) and len(value) > 1:
        return value[1]
    if isinstance(value, str):
        return value
    return None


def parse_vehicle_id(note: str | None) -> int | None:
    if not note:
        return None

    match = VEHICLE_NOTE_RE.search(note)

    if not match:
        return None

    return int(match.group(1))


def month_key(value: str | None) -> str | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(
            value.replace("Z", "")
        ).strftime("%Y-%m")
    except ValueError:
        try:
            return datetime.strptime(
                value[:10],
                "%Y-%m-%d",
            ).strftime("%Y-%m")
        except ValueError:
            return None


def month_label(key: str) -> str:
    return datetime.strptime(
        key,
        "%Y-%m",
    ).strftime("%b")


def build_months(start: date, end: date):
    months = []

    current = date(
        start.year,
        start.month,
        1,
    )

    while current <= end:
        key = current.strftime("%Y-%m")

        months.append(
            {
                "key": key,
                "label": current.strftime("%b"),
                "month": current.month,
                "year": current.year,
                "revenue": 0.0,
                "orders": 0,
                "invoiced": 0.0,
                "collected": 0.0,
            }
        )

        if current.month == 12:
            current = date(
                current.year + 1,
                1,
                1,
            )
        else:
            current = date(
                current.year,
                current.month + 1,
                1,
            )

    return months


def percent_share(
    value: float,
    total: float,
) -> float:
    if total <= 0:
        return 0.0

    return round(
        (value / total) * 100,
        1,
    )


def classify_vehicle_state(state_label: str | None) -> str:
    """
    Same rented/available/other classification used by the fleet
    page and lib/status.ts on the frontend, kept in sync manually
    since this is the only place on the backend that needs it.
    Handles both the French Odoo status labels ('Loué',
    'Disponible') and English equivalents.
    """

    raw = (state_label or "").lower().strip()

    if "loué" in raw or "loue" in raw or "rented" in raw:
        return "rented"

    if "indispon" in raw or "unavailable" in raw:
        return "other"

    if "disponible" in raw or "available" in raw or "ready" in raw:
        return "available"

    return "other"


def get_fleet_utilization() -> dict:
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
                "state_id",
            ],
        },
    )

    total = len(vehicles)
    rented = 0
    available = 0

    eligibility = fleet_eligibility([vehicle["id"] for vehicle in vehicles])
    for vehicle in vehicles:
        state = classify_vehicle_state(
            many2one_name(vehicle.get("state_id"))
        )

        if state == "rented":
            rented += 1
        elif state == "available" and eligibility[vehicle["id"]]["eligible"]:
            available += 1

    utilization = (
        round((rented / total) * 100, 1) if total else 0.0
    )

    return {
        "total_vehicles": total,
        "rented": rented,
        "available": available,
        "utilization_rate": utilization,
    }


def revenue_lines(order_ids: list[int]) -> tuple[list[dict], dict[int, dict]]:
    """Batch-load the product references that distinguish refundable deposits."""
    if not order_ids:
        return [], {}
    lines = odoo.execute("sale.order.line", "search_read",
                         [[["order_id", "in", order_ids]]],
                         {"fields": ["id", "order_id", "product_id", "price_total", "is_downpayment"]})
    product_ids = list({many2one_id(line.get("product_id")) for line in lines} - {None})
    products = odoo.execute("product.product", "search_read", [[["id", "in", product_ids]]],
                            {"fields": ["id", "display_name", "default_code", "categ_id"]}) if product_ids else []
    return lines, {product["id"]: product for product in products}


def deposit_events(order: dict) -> list[dict]:
    events = (read_metadata(order.get("note"), "security_deposit") or {}).get("events", [])
    return [event for event in events if isinstance(event, dict)] if isinstance(events, list) else []


def retained_revenues(orders: list[dict]) -> dict[int, float]:
    """Verify retained income against posted native entries in two bulk reads."""
    events_by_order = {
        order["id"]: [event for event in deposit_events(order) if event.get("action") == "retain"
                      and type(event.get("move_id")) is int and event["move_id"] > 0
                      and type(event.get("amount")) in (int, float)
                      and math.isfinite(event["amount"]) and event["amount"] > 0]
        for order in orders
    }
    move_ids = list({event["move_id"] for events in events_by_order.values() for event in events})
    if not move_ids:
        return {}
    moves = odoo.execute("account.move", "search_read", [[
        ["id", "in", move_ids], ["state", "=", "posted"], ["move_type", "=", "entry"],
    ]], {"fields": ["id", "company_id", "amount_total_signed"]})
    reversals = odoo.execute("account.move", "search_read", [[
        ["reversed_entry_id", "in", move_ids], ["state", "=", "posted"],
    ]], {"fields": ["reversed_entry_id"]})
    reversed_ids = {many2one_id(move.get("reversed_entry_id")) for move in reversals}
    move_map = {move["id"]: move for move in moves if move["id"] not in reversed_ids}
    result = {}
    for order in orders:
        amount = 0.0
        seen = set()
        company_id = many2one_id(order.get("company_id"))
        for event in events_by_order[order["id"]]:
            move = move_map.get(event["move_id"])
            if (not move or event["move_id"] in seen or not company_id
                    or many2one_id(move.get("company_id")) != company_id
                    or not math.isclose(event["amount"], clean_number(move.get("amount_total_signed")),
                                        rel_tol=0.0, abs_tol=0.0000001)):
                continue
            seen.add(event["move_id"])
            amount += event["amount"]
        saved = read_metadata(order.get("note"), "security_deposit") or {}
        result[order["id"]] = min(amount, max(0.0, clean_number(saved.get("retained_amount"))))
    return result


def order_revenue(order: dict, lines: list[dict], products: dict[int, dict], retained_amount: float = 0.0) -> tuple[float, float]:
    deposit = max(0.0, sum(clean_number(line.get("price_total")) for line in lines
                           if not line.get("is_downpayment") and is_security_deposit(products.get(many2one_id(line.get("product_id")), {}))))
    retained = min(deposit, retained_amount)
    return clean_number(order.get("amount_total")) - deposit + retained, retained


def get_period_totals(start_dt: str, end_dt: str, vehicle_id: int | None = None) -> dict:
    """Use the same deposit exclusions as the current period for comparison."""

    orders = odoo.execute(
        "sale.order",
        "search_read",
        [
            [
                ["date_order", ">=", start_dt],
                ["date_order", "<", end_dt],
                ["state", "in", ["sale", "done"]],
            ]
        ],
        {
            "fields": ["id", "amount_total", "note", "company_id"],
            "limit": 3000,
        },
    )

    if vehicle_id:
        orders = [order for order in orders if parse_vehicle_id(order.get("note")) == vehicle_id]

    lines, products = revenue_lines([order["id"] for order in orders])
    retained = retained_revenues(orders)
    lines_by_order = defaultdict(list)
    for line in lines:
        lines_by_order[many2one_id(line.get("order_id"))].append(line)
    revenue = sum(order_revenue(order, lines_by_order[order["id"]], products,
                                retained.get(order["id"], 0.0))[0] for order in orders)

    return {
        "revenue": round(revenue, 2),
        "orders": len(orders),
    }


def percent_change(current: float, previous: float) -> float | None:
    """
    None means 'no baseline to compare against' (previous period
    had zero) rather than a misleading +/-infinity or 0% change —
    the frontend shows 'New' instead of a percentage in that case.
    """

    if previous <= 0:
        return None

    return round(((current - previous) / previous) * 100, 1)


@router.get("")
def get_analytics(
    year: int = Query(
        default=None,
        ge=2020,
        le=2100,
    ),
    start_date: date | None = Query(
        default=None
    ),
    end_date: date | None = Query(
        default=None
    ),
    vehicle_id: int | None = Query(default=None, gt=0),
):
    # ------------------------------------------------------------
    # DATE RANGE
    # ------------------------------------------------------------

    if start_date is None:
        selected_year = year or date.today().year
        start_date = date(
            selected_year,
            1,
            1,
        )

    if end_date is None:
        selected_year = year or start_date.year
        end_date = date(
            selected_year,
            12,
            31,
        )

    end_exclusive = end_date + timedelta(days=1)

    start_dt = (
        f"{start_date.isoformat()} 00:00:00"
    )

    end_dt = (
        f"{end_exclusive.isoformat()} 00:00:00"
    )

    # ------------------------------------------------------------
    # PREVIOUS PERIOD (same length, immediately preceding —
    # e.g. calendar year 2026 compares against calendar year 2025)
    # ------------------------------------------------------------

    period_length = (end_date - start_date).days + 1

    previous_end = start_date - timedelta(days=1)
    previous_start = previous_end - timedelta(
        days=period_length - 1
    )

    previous_start_dt = (
        f"{previous_start.isoformat()} 00:00:00"
    )

    previous_end_dt = (
        f"{(previous_end + timedelta(days=1)).isoformat()} 00:00:00"
    )

    previous_totals = get_period_totals(
        previous_start_dt,
        previous_end_dt,
        vehicle_id,
    )

    # ------------------------------------------------------------
    # SALES ORDERS
    #
    # Only confirmed/completed orders represent actual revenue.
    # Quotations remain outside the financial KPIs.
    # ------------------------------------------------------------

    orders = odoo.execute(
        "sale.order",
        "search_read",
        [
            [
                ["date_order", ">=", start_dt],
                ["date_order", "<", end_dt],
                ["state", "in", ["sale", "done"]],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "company_id",
                "partner_id",
                "state",
                "date_order",
                "amount_total",
                "order_line",
                "note",
            ],
            "order": "date_order asc",
            "limit": 3000,
        },
    )

    vehicle_ids = list({parse_vehicle_id(order.get("note")) for order in orders} - {None})
    vehicles = odoo.execute(
        "fleet.vehicle", "search_read", [[["id", "in", vehicle_ids]]],
        {"fields": ["id", "name", "license_plate", "category_id"]},
    ) if vehicle_ids else []
    vehicle_map = {vehicle["id"]: vehicle for vehicle in vehicles}
    vehicle_options = sorted([
        {"id": vehicle["id"], "name": vehicle["name"], "license_plate": vehicle.get("license_plate") or ""}
        for vehicle in vehicles
    ], key=lambda vehicle: (vehicle["name"], vehicle["id"]))
    if vehicle_id:
        orders = [order for order in orders if parse_vehicle_id(order.get("note")) == vehicle_id]

    if not orders:
        return {
            "range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
            },
            "summary": {
                "revenue": 0,
                "orders": 0,
                "average_order": 0,
                "invoiced": 0,
                "collected": 0,
                "outstanding": 0,
            },
            "comparison": {
                "revenue_change": percent_change(
                    0, previous_totals["revenue"]
                ),
                "orders_change": percent_change(
                    0, previous_totals["orders"]
                ),
            },
            "fleet": get_fleet_utilization(),
            "monthly": build_months(
                start_date,
                end_date,
            ),
            "product_categories": [],
            "fleet_categories": [],
            "vehicles": [],
            "vehicle_options": vehicle_options,
            "customers": [],
            "orders": [],
        }

    # ------------------------------------------------------------
    # MONTHS
    # ------------------------------------------------------------

    months = build_months(
        start_date,
        end_date,
    )

    months_by_key = {
        item["key"]: item
        for item in months
    }

    # ------------------------------------------------------------
    # ORDER IDS
    # ------------------------------------------------------------

    order_ids = [
        order["id"]
        for order in orders
    ]

    # ------------------------------------------------------------
    # SALES LINES
    # ------------------------------------------------------------

    lines, product_map = revenue_lines(order_ids)
    retained_by_order = retained_revenues(orders)
    refund_ids = list({event.get("credit_note_id") for order in orders for event in deposit_events(order)
                       if event.get("action") == "refund" and type(event.get("credit_note_id")) is int
                       and event["credit_note_id"] > 0})

    # ------------------------------------------------------------
    # INVOICES
    # ------------------------------------------------------------

    invoices = odoo.execute(
        "account.move",
        "search_read",
        [
            [
                ["move_type", "in", ["out_invoice", "out_refund"]],
                ["invoice_date", ">=", start_date.isoformat()],
                ["invoice_date", "<=", end_date.isoformat()],
                ["state", "=", "posted"],
                *(["|", ["invoice_line_ids.sale_line_ids.order_id", "in", order_ids],
                   ["id", "in", refund_ids],
                   ["company_id", "in", list({many2one_id(order.get("company_id")) for order in orders} - {None})]]
                  if vehicle_id else []),
            ]
        ],
        {
            "fields": [
                "id",
                "invoice_date",
                "amount_total",
                "amount_residual",
                "payment_state",
                "move_type",
            ],
            "limit": 5000,
        },
    )

    # ------------------------------------------------------------
    # ORDER / LINE MAPS
    # ------------------------------------------------------------

    lines_by_order: dict[int, list] = defaultdict(list)

    for line in lines:
        order_id = many2one_id(
            line.get("order_id")
        )

        if order_id:
            lines_by_order[order_id].append(
                line
            )

    # ------------------------------------------------------------
    # AGGREGATES
    # ------------------------------------------------------------

    revenue = 0.0

    product_revenue = defaultdict(float)
    product_orders = defaultdict(set)

    fleet_revenue = defaultdict(float)
    fleet_orders = defaultdict(set)
    vehicle_revenue = defaultdict(float)
    vehicle_orders = defaultdict(set)

    customer_revenue = defaultdict(float)
    customer_orders = defaultdict(int)

    order_rows = []

    for order in orders:
        amount, retained = order_revenue(order, lines_by_order.get(order["id"], []), product_map,
                                         retained_by_order.get(order["id"], 0.0))

        revenue += amount

        order_month = month_key(
            order.get("date_order")
        )

        if order_month in months_by_key:
            months_by_key[order_month][
                "revenue"
            ] += amount

            months_by_key[order_month][
                "orders"
            ] += 1

        # --------------------------------------------------------
        # CUSTOMER
        # --------------------------------------------------------

        customer_name = (
            many2one_name(
                order.get("partner_id")
            )
            or "Unknown customer"
        )

        customer_revenue[
            customer_name
        ] += amount

        customer_orders[
            customer_name
        ] += 1

        # --------------------------------------------------------
        # PRODUCT CATEGORIES
        #
        # Product category revenue comes from actual order lines,
        # not from arbitrary frontend labels.
        # --------------------------------------------------------

        for line in lines_by_order.get(
            order["id"],
            [],
        ):
            line_revenue = clean_number(
                line.get("price_total")
            )

            product = product_map.get(
                many2one_id(
                    line.get("product_id")
                )
            )
            if not line.get("is_downpayment") and is_security_deposit(product or {}):
                continue

            category = (
                many2one_name(
                    product.get("categ_id")
                )
                if product
                else None
            ) or "Other"

            product_revenue[
                category
            ] += line_revenue

            product_orders[
                category
            ].add(order["id"])

        if retained:
            product_revenue["Damage compensation"] += retained
            product_orders["Damage compensation"].add(order["id"])

        # --------------------------------------------------------
        # FLEET CATEGORY
        #
        # Each rental belongs to the category of its vehicle.
        # The order's total revenue is assigned to that fleet
        # category because the rental order represents one vehicle.
        # --------------------------------------------------------

        order_vehicle_id = parse_vehicle_id(
            order.get("note")
        )

        vehicle = (
            vehicle_map.get(order_vehicle_id)
            if order_vehicle_id
            else None
        )
        if order_vehicle_id:
            vehicle_revenue[order_vehicle_id] += amount
            vehicle_orders[order_vehicle_id].add(order["id"])

        fleet_category = (
            many2one_name(
                vehicle.get("category_id")
            )
            if vehicle
            else None
        ) or "Other"

        fleet_revenue[
            fleet_category
        ] += amount

        fleet_orders[
            fleet_category
        ].add(order["id"])

        order_rows.append(
            {
                "id": order["id"],
                "name": order["name"],
                "customer": customer_name,
                "date": order.get("date_order"),
                "amount": amount,
                "state": order.get("state"),
                "vehicle_id": order_vehicle_id,
                "vehicle": (
                    vehicle.get("name")
                    if vehicle
                    else None
                ),
                "fleet_category": fleet_category,
            }
        )

    # ------------------------------------------------------------
    # INVOICE METRICS
    # ------------------------------------------------------------

    invoiced = 0.0
    collected = 0.0
    outstanding = 0.0

    for invoice in invoices:
        amount_total = clean_number(
            invoice.get("amount_total")
        )

        residual = clean_number(
            invoice.get("amount_residual")
        )

        # Credit notes reduce billed revenue.
        sign = (
            -1
            if invoice.get("move_type")
            == "out_refund"
            else 1
        )

        invoiced += (
            amount_total * sign
        )

        outstanding += (
            residual * sign
        )

        collected += (
            (amount_total - residual)
            * sign
        )

    # ------------------------------------------------------------
    # BREAKDOWNS
    # ------------------------------------------------------------

    product_categories = [
        {
            "name": name,
            "revenue": round(value, 2),
            "orders": len(
                product_orders[name]
            ),
            "share": percent_share(
                value,
                revenue,
            ),
        }
        for name, value in product_revenue.items()
        if value > 0
    ]

    fleet_categories = [
        {
            "name": name,
            "revenue": round(value, 2),
            "orders": len(
                fleet_orders[name]
            ),
            "share": percent_share(
                value,
                revenue,
            ),
        }
        for name, value in fleet_revenue.items()
        if value > 0
    ]

    customers = [
        {
            "name": name,
            "revenue": round(value, 2),
            "orders": customer_orders[name],
        }
        for name, value in customer_revenue.items()
        if value > 0
    ]

    product_categories.sort(
        key=lambda item: item["revenue"],
        reverse=True,
    )

    fleet_categories.sort(
        key=lambda item: item["revenue"],
        reverse=True,
    )

    customers.sort(
        key=lambda item: item["revenue"],
        reverse=True,
    )

    vehicle_breakdown = sorted([
        {
            "id": identifier,
            "name": vehicle_map.get(identifier, {}).get("name") or f"Vehicle #{identifier}",
            "license_plate": vehicle_map.get(identifier, {}).get("license_plate") or "",
            "revenue": round(amount, 2),
            "orders": len(vehicle_orders[identifier]),
            "share": percent_share(amount, revenue),
        }
        for identifier, amount in vehicle_revenue.items()
    ], key=lambda vehicle: (-vehicle["orders"], -vehicle["revenue"], vehicle["id"]))

    return {
        "range": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
        },
        "summary": {
            "revenue": round(revenue, 2),
            "orders": len(orders),
            "average_order": round(
                revenue / len(orders),
                2,
            )
            if orders
            else 0,
            "invoiced": round(
                invoiced,
                2,
            ),
            "collected": round(
                collected,
                2,
            ),
            "outstanding": round(
                outstanding,
                2,
            ),
        },
        "comparison": {
            "revenue_change": percent_change(
                revenue, previous_totals["revenue"]
            ),
            "orders_change": percent_change(
                len(orders), previous_totals["orders"]
            ),
        },
        "fleet": get_fleet_utilization(),
        "monthly": months,
        "product_categories": product_categories,
        "fleet_categories": fleet_categories,
        "vehicles": vehicle_breakdown,
        "vehicle_options": vehicle_options,
        "customers": customers[:20],
        "orders": order_rows,
    }
