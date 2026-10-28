from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from fastapi.responses import Response


from app.odoo_client import odoo, safe_odoo_message
from app.verticals.car_rental.crm_journey import sync_order, order_documents_saved
from app.routes.calendar import QUOTATION_TAG, rental_vehicle_id, booking_status
from app.routes.cars import PICKED_UP_TAG, RETURNED_TAG
from app.verticals.car_rental.returns import ReturnCondition, ReturnInspection, can_return, return_record
from app.verticals.car_rental.deposits import DepositSettlement
from app.core.documents import CUSTOMER_KINDS, document_router, checklist_from_records
from app.core.record_metadata import read_metadata
from app.verticals.car_rental import contracts


router = APIRouter(
    prefix="/sales",
    tags=["Sales"]
)


# =========================================================
# GET SALES ORDERS
# =========================================================

@router.get("")
def get_sales(for_fleet: bool = False, for_calendar: bool = False, with_paperwork: bool = False):

    domain = []
    if for_fleet:
        domain = [["state", "!=", "cancel"],
                  ["note", "ilike", "[Rental OS fleet.vehicle:"],
                  ["note", "not ilike", RETURNED_TAG]]

    orders = odoo.execute(
        "sale.order",
        "search_read",
        [domain],
        {
            "fields": (["company_id", "currency_id"] if with_paperwork else []) + [
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
            "order": "id desc",
            **({} if for_fleet or for_calendar else {"limit": 100}),
        }
    )

    paperwork = contracts.batch_paperwork(orders) if with_paperwork else {}
    result = []

    for order in orders:

        result.append({
            "id": order["id"],
            "name": order["name"],

            "customer": (
                {
                    "id": order["partner_id"][0],
                    "name": order["partner_id"][1],
                }
                if order["partner_id"]
                else None
            ),

            "state": order["state"],
            "date_order": order["date_order"] or None,
            "commitment_date": order["commitment_date"] or None,

            "amount_total": order["amount_total"],
            "invoice_status": order["invoice_status"],

            "opportunity": (
                {
                    "id": order["opportunity_id"][0],
                    "name": order["opportunity_id"][1],
                }
                if order["opportunity_id"]
                else None
            ),

            "order_line_ids": order["order_line"],
            "vehicle_id": rental_vehicle_id(order.get("note")),
            "logistics": read_metadata(order.get("note"), "rental_logistics") or {},
            "booking_status": booking_status(order),
            "returned": RETURNED_TAG in (order.get("note") or ""),
            "picked_up": PICKED_UP_TAG in (order.get("note") or ""),
            **({"paperwork": paperwork.get(order["id"])} if with_paperwork else {}),
        })

    return {
        "count": len(result),
        "sales": result,
    }


# =========================================================
# GET SALE ORDER
# =========================================================

@router.get("/{order_id}")
def get_sale(order_id: int):

    orders = odoo.execute(
        "sale.order",
        "search_read",
        [
            [
                ["id", "=", order_id]
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
                "amount_untaxed",
                "amount_tax",
                "amount_total",
                "invoice_status",
                "amount_invoiced",
                "amount_to_invoice",
                "invoice_ids",
                "opportunity_id",
                "order_line",
                "note",
            ]
        }
    )

    if not orders:
        raise HTTPException(status_code=404, detail="Rental not found.")

    order = orders[0]

    # ------------------------------------------------------
    # ORDER LINES — the quotation itself
    # ------------------------------------------------------

    lines = odoo.execute(
        "sale.order.line",
        "search_read",
        [[["order_id", "=", order_id], ["display_type", "=", False]]],
        {
            "fields": [
                "id",
                "product_id",
                "name",
                "product_uom_qty",
                "price_unit",
                "discount",
                "price_subtotal",
                "price_total",
                "is_downpayment",
            ],
            "order": "sequence, id",
        },
    )

    order_lines = [
        {
            "id": line["id"],
            "is_downpayment": line.get("is_downpayment", False),
            "product": (
                {
                    "id": line["product_id"][0],
                    "name": line["product_id"][1],
                }
                if line.get("product_id")
                else None
            ),
            "description": line["name"],
            "quantity": line["product_uom_qty"],
            "unit_price": line["price_unit"],
            "discount_percent": line["discount"] or 0,
            "subtotal": line["price_subtotal"],
            "total": line["price_total"],
        }
        for line in lines
    ]

    # ------------------------------------------------------
    # INVOICES — status + payment picture, no accounting
    # jargon leaking through (Odoo's payment_state values are
    # normalized to plain words on the way out)
    # ------------------------------------------------------

    invoices = []

    if order.get("invoice_ids"):
        invoice_records = odoo.execute(
            "account.move",
            "search_read",
            [[["id", "in", order["invoice_ids"]]]],
            {
                "fields": [
                    "id",
                    "name",
                    "state",
                    "payment_state",
                    "invoice_date",
                    "invoice_date_due",
                    "amount_total",
                    "amount_residual",
                    "move_type",
                ],
                "order": "id",
            },
        )

        invoices = [
            {
                "id": invoice["id"],
                "name": invoice["name"],
                "draft": invoice["state"] == "draft",
                "state": invoice["state"],
                "type": invoice["move_type"],
                "payment_status": invoice["payment_state"],
                "date": invoice["invoice_date"],
                "due_date": invoice["invoice_date_due"],
                "total": invoice["amount_total"],
                "paid": (invoice["amount_total"] - invoice["amount_residual"])
                if invoice["state"] == "posted" else 0,
                "outstanding": invoice["amount_residual"],
            }
            for invoice in invoice_records if invoice["state"] != "cancel"
        ]

    return {
        "id": order["id"],
        "name": order["name"],

        "customer": (
            {
                "id": order["partner_id"][0],
                "name": order["partner_id"][1],
            }
            if order["partner_id"]
            else None
        ),

        "state": order["state"],
        "date_order": order["date_order"] or None,
        "commitment_date": order["commitment_date"] or None,

        "amount_untaxed": order["amount_untaxed"],
        "amount_tax": order["amount_tax"],
        "amount_total": order["amount_total"],

        "invoice_status": order["invoice_status"],
        "amount_invoiced": sum(
            i["total"] * (-1 if i["type"] == "out_refund" else 1)
            for i in invoices if i["state"] == "posted"
        ),
        "amount_paid": sum(
            i["paid"] * (-1 if i["type"] == "out_refund" else 1)
            for i in invoices if i["state"] == "posted"
        ),
        "amount_outstanding": max(0, order["amount_total"] - sum(
            i["paid"] * (-1 if i["type"] == "out_refund" else 1)
            for i in invoices if i["state"] == "posted"
        )),
        "amount_to_invoice": order["amount_to_invoice"],

        "lines": order_lines,
        "invoices": invoices,

        "opportunity": (
            {
                "id": order["opportunity_id"][0],
                "name": order["opportunity_id"][1],
            }
            if order["opportunity_id"]
            else None
        ),

        "returned": RETURNED_TAG in (order.get("note") or ""),
        "picked_up": PICKED_UP_TAG in (order.get("note") or ""),
        "return_record": record.model_dump(mode="json") if (record := return_record(order.get("note"))) else None,
        "can_return": can_return(order),
        "order_line_ids": order["order_line"],
        "vehicle_id": rental_vehicle_id(order.get("note")),
        "logistics": read_metadata(order.get("note"), "rental_logistics") or {},
        "booking_status": booking_status(order),
    }


def sale_record(order_id: int, fields: list[str] | None = None, editable=False):
    records = odoo.execute("sale.order", "search_read", [[["id", "=", order_id]]],
                           {"fields": fields or ["state"], "limit": 1})
    if not records:
        raise HTTPException(404, "Rental not found.")
    if editable and records[0]["state"] not in ("draft", "sent"):
        raise HTTPException(400, "Only a draft or sent quotation can be edited.")
    return records[0]


def require_deposit_addon():
    modules = odoo.execute("ir.module.module", "search_read", [[
        ["name", "=", "klynx_rental_deposits"], ["state", "=", "installed"],
    ]], {"fields": ["id"], "limit": 1})
    if not modules:
        raise HTTPException(409, "Install the Klynx rental deposits addon in Odoo 18 Community to enable deposit refunds and return verification.")


@router.get("/{order_id}/security-deposit")
def security_deposit(order_id: int):
    sale_record(order_id)
    require_deposit_addon()
    return odoo.execute("sale.order", "klynx_deposit_snapshot", [[order_id]])


@router.post("/{order_id}/security-deposit/settlements")
def settle_security_deposit(order_id: int, data: DepositSettlement):
    sale_record(order_id)
    require_deposit_addon()
    return odoo.execute("sale.order", "klynx_deposit_settle", [[order_id], data.model_dump(mode="json")])


class InspectionRequest(ReturnCondition):
    inspection: ReturnInspection


@router.put("/{order_id}/return-inspection")
def save_return_inspection(order_id: int, data: InspectionRequest):
    sale_record(order_id)
    require_deposit_addon()
    return odoo.execute("sale.order", "klynx_save_return_inspection", [[order_id], data.model_dump(mode="json")])


def owned_line(order_id: int, line_id: int):
    sale_record(order_id, editable=True)
    lines = odoo.execute("sale.order.line", "search_read",
                         [[["id", "=", line_id], ["order_id", "=", order_id],
                           ["display_type", "=", False], ["is_downpayment", "=", False]]],
                         {"fields": ["id", "qty_invoiced", "qty_delivered"], "limit": 1})
    if not lines:
        raise HTTPException(404, "Quotation line not found in this rental.")
    ensure_unbilled(lines)


def ensure_unbilled(lines):
    if any(line.get("qty_invoiced") or line.get("qty_delivered") for line in lines):
        raise HTTPException(409, "Invoiced or delivered articles cannot be changed here. Use an accounting adjustment instead.")


class LineUpdate(BaseModel):
    quantity: float | None = Field(None, gt=0, le=1000000, allow_inf_nan=False)
    unit_price: float | None = Field(None, ge=0, le=1000000000, allow_inf_nan=False)
    discount_percent: float | None = Field(None, ge=0, le=100, allow_inf_nan=False)


class LineCreate(BaseModel):
    product_id: int = Field(gt=0)
    quantity: float = Field(1, gt=0, le=1000000, allow_inf_nan=False)
    unit_price: float | None = Field(None, ge=0, le=1000000000, allow_inf_nan=False)


class OrderDiscount(BaseModel):
    discount_percent: float = Field(ge=0, le=100, allow_inf_nan=False)


@router.patch("/{order_id}/lines/{line_id}")
def update_line(order_id: int, line_id: int, update: LineUpdate):
    owned_line(order_id, line_id)
    mapping = {"quantity": "product_uom_qty", "unit_price": "price_unit", "discount_percent": "discount"}
    values = {mapping[key]: value for key, value in update.model_dump().items() if value is not None}
    if not values:
        raise HTTPException(400, "Nothing to update.")
    odoo.execute("sale.order.line", "write", [[line_id], values])
    return {"line_id": line_id, "updated": values}


@router.post("/{order_id}/lines")
def add_line(order_id: int, line: LineCreate):
    sale_record(order_id, editable=True)
    products = odoo.execute("product.product", "search_read",
                            [[["id", "=", line.product_id], ["sale_ok", "=", True]]],
                            {"fields": ["id"], "limit": 1})
    if not products:
        raise HTTPException(404, "Choose a saleable product.")
    # Odoo computes description, UoM, pricelist price, taxes and fiscal-position mapping.
    values = {"order_id": order_id, "product_id": line.product_id, "product_uom_qty": line.quantity}
    if line.unit_price is not None:
        values["price_unit"] = line.unit_price
    line_id = odoo.execute("sale.order.line", "create", [values])
    return {"line_id": line_id}


@router.delete("/{order_id}/lines/{line_id}")
def remove_line(order_id: int, line_id: int):
    owned_line(order_id, line_id)
    odoo.execute("sale.order.line", "unlink", [[line_id]])
    return {"line_id": line_id, "removed": True}


@router.patch("/{order_id}/discount")
def discount_order(order_id: int, discount: OrderDiscount):
    sale_record(order_id, editable=True)
    lines = odoo.execute("sale.order.line", "search_read", [[["order_id", "=", order_id],
                         ["display_type", "=", False], ["is_downpayment", "=", False]]],
                         {"fields": ["id", "qty_invoiced", "qty_delivered"]})
    ensure_unbilled(lines)
    if lines:
        # Matches Odoo's "On All Order Lines" discount: replaces existing line discounts.
        odoo.execute("sale.order.line", "write", [[line["id"] for line in lines], {"discount": discount.discount_percent}])
    return {"discount_percent": discount.discount_percent}


@router.post("/{order_id}/confirm")
def confirm_quotation(order_id: int):
    order = sale_record(order_id, ["state", "date_order", "note", "opportunity_id"], editable=True)
    note = order.get("note") or ""
    odoo.execute("sale.order", "action_confirm", [[order_id]])
    if QUOTATION_TAG not in note:
        odoo.execute("sale.order", "write", [[order_id], {"note": f"{note}\n{QUOTATION_TAG}"}])
    # This installation stores pickup in date_order; Odoo confirmation otherwise resets it.
    if order.get("date_order"):
        odoo.execute("sale.order", "write", [[order_id], {"date_order": order["date_order"]}])
    return {"order_id": order_id, "state": "sale", **sync_order(order)}


class InvoiceCreate(BaseModel):
    deposit_amount: float | None = Field(None, gt=0, allow_inf_nan=False)
    security_deposit_only: bool = False


@router.post("/{order_id}/invoice")
def create_invoice(order_id: int, request: InvoiceCreate | None = None):
    order = sale_record(order_id, ["state", "invoice_ids", "amount_to_invoice"])
    if order["state"] not in ("sale", "done"):
        raise HTTPException(400, "Confirm the quotation before generating an invoice.")
    if request and request.security_deposit_only:
        if request.deposit_amount is not None:
            raise HTTPException(422, "Choose either a rental advance or a security deposit invoice.")
        require_deposit_addon()
        return odoo.execute("sale.order", "klynx_create_deposit_invoice", [[order_id]])
    # Reuse a pending draft instead of creating duplicates on a repeated click.
    drafts = odoo.execute("account.move", "search", [[["id", "in", order.get("invoice_ids") or []],
                          ["state", "=", "draft"], ["move_type", "=", "out_invoice"]]])
    if drafts:
        if request and request.deposit_amount is not None:
            raise HTTPException(409, "A draft invoice already exists. Review or cancel it in Odoo before requesting a deposit amount.")
        return {"order_id": order_id, "invoice_ids": drafts, "existing_draft": True}
    context = {"active_model": "sale.order", "active_ids": [order_id], "active_id": order_id}
    values = {"advance_payment_method": "delivered", "sale_order_ids": [[6, 0, [order_id]]]}
    if request and request.deposit_amount is not None:
        if request.deposit_amount > order["amount_to_invoice"]:
            raise HTTPException(422, "The deposit cannot exceed the remaining amount to invoice.")
        values.update(advance_payment_method="fixed", fixed_amount=request.deposit_amount)
    else:
        lines = odoo.execute("sale.order.line", "search_read", [[["order_id", "=", order_id],
            ["display_type", "=", False], ["is_downpayment", "=", False]]],
            {"fields": ["product_id", "qty_to_invoice", "qty_delivered", "invoice_status"]})
        products = odoo.execute("product.product", "read", [[line["product_id"][0] for line in lines if line.get("product_id")]],
            {"fields": ["invoice_policy", "display_name"]}) if lines else []
        policies = {product["id"]: product for product in products}
        blocked = [policies[line["product_id"][0]]["display_name"] for line in lines if line.get("product_id")
            and policies.get(line["product_id"][0], {}).get("invoice_policy") == "delivery"
            and line["qty_to_invoice"] <= 0 and line["qty_delivered"] <= 0 and line["invoice_status"] == "no"]
        if blocked:
            names = safe_odoo_message({"message": ", ".join(blocked)}, "Rental product")
            raise HTTPException(422, f"{names}: invoice policy is delivered quantities, but no delivery is recorded. Review delivery or the product invoice policy in Odoo.")
    wizard = odoo.execute("sale.advance.payment.inv", "create",
                          [values],
                          {"context": context})
    odoo.execute("sale.advance.payment.inv", "create_invoices", [[wizard]], {"context": context})
    refreshed = sale_record(order_id, ["invoice_ids"])
    return {"order_id": order_id,
            "invoice_ids": sorted(set(refreshed.get("invoice_ids") or []) - set(order.get("invoice_ids") or []))}


@router.get("/{order_id}/print-link")
def quotation_print_link(order_id: int):
    sale_record(order_id)
    return {"url": f"/api/backend/sales/{order_id}/document"}


@router.get("/{order_id}/paperwork")
def rental_paperwork(order_id: int):
    order, checklist, status = contracts.paperwork(order_id)
    driver = status["additional_driver"]
    if driver["profile"] and driver["profile"]["active"]:
        driver["fee_status"] = contracts.driver_fee_status(order)
    copies = rental_document_copies(order_id, order)
    driver["rental_documents"] = checklist_from_records(copies, CUSTOMER_KINDS, "additional_driver_snapshot")["documents"]
    status["rental_documents"] = checklist_from_records(copies, CUSTOMER_KINDS)["documents"]
    return {**status, "details": {**contracts.customer_details(checklist), **(read_metadata(order.get("note"), "rental_paperwork") or {})}}


@router.put("/{order_id}/additional-driver")
def save_additional_driver(order_id: int, data: contracts.AdditionalDriver):
    result = contracts.save_driver(order_id, data)
    return {**result, **order_documents_saved(order_id)}


_driver_documents = document_router("sale.order", CUSTOMER_KINDS, "additional_driver", contracts.driver_document_guard,
                                    after_save=order_documents_saved)
for _route in _driver_documents.routes:
    if _route.methods != {"GET"} or "attachment_id" in _route.path:
        router.add_api_route("/{record_id}/additional-driver/documents" + _route.path.removeprefix("/{record_id}/documents"),
                             _route.endpoint, methods=list(_route.methods))


@router.get("/{record_id}/additional-driver/documents")
def additional_driver_documents(record_id: int):
    state = contracts.driver_state(contracts.order_record(record_id))
    return {"documents": state["documents"], "ready": state["ready"]}


@router.get("/{order_id}/contract")
def rental_contract(order_id: int):
    order = contracts.order_record(order_id)
    if booking_status(order) == "cancelled":
        raise HTTPException(409, "A cancelled booking cannot open a rental contract.")
    record = read_metadata(order.get("note"), "rental_contract")
    if not record:
        raise HTTPException(409, "Verify the client documents, then prepare the rental contract.")
    return {"contract_id": record["contract_id"], "html": contracts.stored_contract(order)}


@router.post("/{order_id}/contract/prepare")
def prepare_rental_contract(order_id: int, data: contracts.ContractPrepare):
    return contracts.prepare_contract(order_id, data)


@router.post("/{order_id}/contract/printed")
def confirm_rental_contract(order_id: int, data: contracts.ContractPrinted):
    return contracts.confirm_printed(order_id, data)


@router.get("/{order_id}/contract/template")
def rental_template(order_id: int):
    return {**contracts.company_template(contracts.order_record(order_id), True), "fields": contracts.FIELDS}


@router.put("/{order_id}/contract/template")
def update_rental_template(order_id: int, data: contracts.TemplateSetup):
    return contracts.save_template(order_id, data)


# Rental snapshots are immutable. Agents edit the reusable customer originals instead.
_snapshots = document_router("sale.order", CUSTOMER_KINDS)
for _route in _snapshots.routes:
    if "GET" in _route.methods and "attachment_id" in _route.path:
        router.add_api_route("/{record_id}/documents" + _route.path.removeprefix("/{record_id}/documents"), _route.endpoint, methods=["GET"])


def rental_document_copies(order_id, order=None):
    order = order or contracts.order_record(order_id)
    record = read_metadata(order.get("note"), "rental_contract") or {}
    return odoo.execute("ir.attachment", "search_read", [[["id", "in", record.get("snapshot_ids") or []],
        ["res_model", "=", "sale.order"], ["res_id", "=", order_id], ["type", "=", "binary"], ["public", "=", False]]],
        {"fields": ["id", "name", "description", "checksum"], "order": "id desc"}) if record.get("snapshot_ids") else []


@router.get("/{record_id}/documents")
def rental_documents(record_id: int):
    return checklist_from_records(rental_document_copies(record_id), CUSTOMER_KINDS)


_driver_snapshots = document_router("sale.order", CUSTOMER_KINDS, "additional_driver_snapshot")
for _route in _driver_snapshots.routes:
    if "GET" in _route.methods and "attachment_id" in _route.path:
        router.add_api_route("/{record_id}/additional-driver/copies" + _route.path.removeprefix("/{record_id}/documents"), _route.endpoint, methods=["GET"])


@router.get("/{order_id}/document")
def quotation_document(order_id: int):
    sale_record(order_id)
    return Response(odoo.document("sale.report_saleorder", order_id), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="quotation-{order_id}.pdf"'})


@router.post("/{order_id}/send")
def send_quotation(order_id: int):
    order = sale_record(order_id, ["state", "partner_id"])
    if order["state"] == "cancel":
        raise HTTPException(400, "A cancelled quotation cannot be sent.")
    partners = odoo.execute("res.partner", "read", [[order["partner_id"][0]]], {"fields": ["email"]})
    if not partners or not partners[0].get("email"):
        raise HTTPException(400, "Add the customer's email address before sending.")
    action = odoo.execute("sale.order", "action_quotation_send", [[order_id]])
    context = action.get("context") or {}
    if not context.get("default_template_id"):
        raise HTTPException(400, "Configure a quotation email template before sending.")
    wizard = odoo.execute("mail.compose.message", "create", [{}], {"context": context})
    odoo.execute("mail.compose.message", "action_send_mail", [[wizard]], {"context": context})
    return {"order_id": order_id, "sent": True}
