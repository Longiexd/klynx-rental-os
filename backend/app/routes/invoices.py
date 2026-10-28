from datetime import date
from collections import OrderedDict
from threading import Lock
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from fastapi.responses import Response


from app.odoo_client import odoo, current_client

# Bounded locks serialize double clicks in the API process (one Uvicorn worker).
# Odoo remains responsible for payment creation and reconciliation.
_payment_locks = [Lock() for _ in range(64)]
_recent_payments = OrderedDict()
_recent_payments_lock = Lock()
_DOUBLE_CLICK_SECONDS = 5


router = APIRouter(
    prefix="/invoices",
    tags=["Invoices"]
)


# =========================================================
# GET INVOICES
# =========================================================

@router.get("")
def get_invoices():

    invoices = odoo.execute(
        "account.move",
        "search_read",
        [
            [
                ["move_type", "in", ["out_invoice", "out_refund"]]
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "partner_id",
                "move_type",
                "state",
                "invoice_date",
                "invoice_date_due",
                "amount_untaxed",
                "amount_tax",
                "amount_total",
                "amount_residual",
                "payment_state",
                "invoice_origin",
                "invoice_line_ids",
            ],
            "order": "id desc",
            "limit": 100,
        }
    )

    result = []

    for invoice in invoices:

        result.append({
            "id": invoice["id"],
            "name": invoice["name"],

            "customer": (
                {
                    "id": invoice["partner_id"][0],
                    "name": invoice["partner_id"][1],
                }
                if invoice["partner_id"]
                else None
            ),

            "type": invoice["move_type"],
            "state": invoice["state"],

            "invoice_date": invoice["invoice_date"],
            "due_date": invoice["invoice_date_due"],

            "amount_untaxed": invoice["amount_untaxed"],
            "amount_tax": invoice["amount_tax"],
            "amount_total": invoice["amount_total"],
            "amount_residual": invoice["amount_residual"],

            "payment_state": invoice["payment_state"],
            "origin": invoice["invoice_origin"],

            "invoice_line_ids": invoice["invoice_line_ids"],
        })

    return {
        "count": len(result),
        "invoices": result,
    }


# =========================================================
# PAYMENT JOURNALS
#
# Bank/cash journals to record a payment against. Fetched
# rather than hardcoded since every Odoo instance configures
# its own.
# =========================================================

@router.get("/payment-journals")
def get_payment_journals(invoice_id: int | None = None):

    client = odoo._client()
    user = odoo.execute("res.users", "read", [[client.profile["uid"]]], {"fields": ["company_id"]})[0]
    company_id = user["company_id"][0]
    if invoice_id is not None:
        records = odoo.execute("account.move", "search_read", [[["id", "=", invoice_id],
            ["company_id", "=", company_id], ["move_type", "=", "out_invoice"]]], {"fields": ["company_id"], "limit": 1})
        if not records:
            raise HTTPException(404, "Customer invoice not found in the current company.")
        company_id = records[0]["company_id"][0]

    journals = odoo.execute(
        "account.journal",
        "search_read",
        [[["type", "in", ["bank", "cash"]], ["company_id", "=", company_id]]],
        {"fields": ["id", "name"], "order": "sequence"},
    )

    return {"journals": journals}


# =========================================================
# RECORD PAYMENT
#
# Uses Odoo's own account.payment.register wizard — the same
# mechanism the Odoo Accounting UI itself uses to register a
# payment and reconcile it — rather than manually creating an
# account.payment and reconciling it ourselves. Supports
# partial payments and being called multiple times against the
# same invoice (Odoo's payment_state naturally becomes
# "partial" then "paid" as residual amount decreases).
# =========================================================

class PaymentCreate(BaseModel):
    amount: float = Field(gt=0, le=1000000000, allow_inf_nan=False)
    journal_id: int = Field(gt=0)
    payment_date: date | None = None


@router.post("/{invoice_id}/payments")
def record_payment(
    invoice_id: int,
    payment: PaymentCreate,
):
    client = current_client.get()
    company = (client.profile["code"], client.profile["database_name"]) if client else None
    with _payment_locks[hash((company, invoice_id)) % len(_payment_locks)]:
        fingerprint = (company, client.profile["uid"], invoice_id, payment.amount,
                       payment.journal_id, payment.payment_date) if client else None
        if fingerprint:
            with _recent_payments_lock:
                recorded = _recent_payments.get(fingerprint)
                if recorded is not None and time.monotonic() - recorded < _DOUBLE_CLICK_SECONDS:
                    raise HTTPException(409, "This payment was just recorded. Refresh the invoice before trying again.")
        return _record_payment(invoice_id, payment, fingerprint)


def _record_payment(invoice_id: int, payment: PaymentCreate, fingerprint=None):

    if payment.amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="Payment amount must be greater than zero.",
        )

    invoices = odoo.execute(
        "account.move",
        "search_read",
        [[["id", "=", invoice_id]]],
        {"fields": ["state", "amount_residual", "move_type", "company_id"]},
    )

    if not invoices:
        raise HTTPException(
            status_code=404,
            detail="Invoice not found.",
        )

    invoice = invoices[0]

    if invoice["move_type"] != "out_invoice":
        raise HTTPException(400, "Only a customer invoice can receive a payment here.")

    if invoice["state"] != "posted":
        raise HTTPException(
            status_code=400,
            detail="This invoice isn't posted yet.",
        )

    if payment.amount > invoice["amount_residual"] + 0.01:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Payment of {payment.amount} exceeds the "
                f"outstanding balance of "
                f"{invoice['amount_residual']}."
            ),
        )

    journals = odoo.execute("account.journal", "search_read",
                            [[["id", "=", payment.journal_id], ["type", "in", ["bank", "cash"]],
                              ["company_id", "=", invoice["company_id"][0]]]],
                            {"fields": ["id"], "limit": 1})
    if not journals:
        raise HTTPException(400, "Choose a bank or cash account belonging to this invoice company.")

    context = {"active_model": "account.move", "active_ids": [invoice_id], "active_id": invoice_id}
    latest = odoo.execute("account.move", "read", [[invoice_id]],
                          {"fields": ["state", "amount_residual", "company_id"]})[0]
    if latest["state"] != "posted" or latest["company_id"][0] != invoice["company_id"][0]:
        raise HTTPException(409, "The invoice changed. Refresh before recording a payment.")
    if payment.amount > latest["amount_residual"]:
        raise HTTPException(409, "Payment exceeds the current outstanding balance. Refresh before retrying.")
    wizard_id = odoo.execute(
        "account.payment.register",
        "create",
        [
            {
                "amount": payment.amount,
                "journal_id": payment.journal_id,
                "payment_date": (
                    (payment.payment_date or date.today()).isoformat()
                ),
            }
        ],
        {
            "context": {
                **context,
            }
        },
    )

    odoo.execute(
        "account.payment.register",
        "action_create_payments",
        [[wizard_id]],
        {"context": context},
    )
    if fingerprint:
        # Record successful Odoo creation before readback: a readback failure
        # must not turn an immediate retry into another partial payment.
        with _recent_payments_lock:
            _recent_payments[fingerprint] = time.monotonic()
            _recent_payments.move_to_end(fingerprint)
            while len(_recent_payments) > 1024:
                _recent_payments.popitem(last=False)

    refreshed = odoo.execute(
        "account.move",
        "search_read",
        [[["id", "=", invoice_id]]],
        {
            "fields": [
                "payment_state",
                "amount_residual",
                "amount_total",
            ],
        },
    )[0]

    return {
        "invoice_id": invoice_id,
        "payment_status": refreshed["payment_state"],
        "paid": (
            refreshed["amount_total"]
            - refreshed["amount_residual"]
        ),
        "outstanding": refreshed["amount_residual"],
        "payment_state": refreshed["payment_state"],
        "amount_residual": refreshed["amount_residual"],
    }


# =========================================================
# PAYMENT HISTORY
#
# Reads the payments actually reconciled against this
# invoice, via the same account.partial.reconcile records
# Odoo's own UI uses to show payment history on an invoice.
# =========================================================

@router.get("/{invoice_id}/payments")
def get_payment_history(invoice_id: int):

    invoices = odoo.execute(
        "account.move",
        "search_read",
        [[["id", "=", invoice_id]]],
        {"fields": ["line_ids"]},
    )

    if not invoices:
        raise HTTPException(
            status_code=404,
            detail="Invoice not found.",
        )

    move_lines = odoo.execute(
        "account.move.line",
        "search_read",
        [
            [
                ["move_id", "=", invoice_id],
                ["account_type", "=", "asset_receivable"],
            ]
        ],
        {
            "fields": [
                "matched_debit_ids",
                "matched_credit_ids",
            ],
        },
    )

    reconcile_ids = set()

    for line in move_lines:
        reconcile_ids.update(line.get("matched_debit_ids") or [])
        reconcile_ids.update(line.get("matched_credit_ids") or [])

    if not reconcile_ids:
        return {"payments": []}

    reconciles = odoo.execute(
        "account.partial.reconcile",
        "search_read",
        [[["id", "in", list(reconcile_ids)]]],
        {
            "fields": [
                "amount",
                "max_date",
                "credit_move_id",
            ],
        },
    )

    payments = []

    for reconcile in reconciles:
        payment_move = reconcile.get("credit_move_id")

        payments.append(
            {
                "amount": reconcile["amount"],
                "date": reconcile["max_date"],
                "reference": (
                    payment_move[1] if payment_move else None
                ),
            }
        )

    payments.sort(key=lambda item: item["date"] or "", reverse=True)

    return {"payments": payments}

def invoice_record(invoice_id: int, *, include_refunds: bool = False):
    records = odoo.execute("account.move", "search_read", [[["id", "=", invoice_id],
                           ["move_type", "in", ["out_invoice", "out_refund"]] if include_refunds else
                           ["move_type", "=", "out_invoice"]]], {"fields": ["state", "amount_residual", "payment_state"], "limit": 1})
    if not records:
        raise HTTPException(404, "Customer invoice not found.")
    return records[0]


@router.post("/{invoice_id}/post")
def post_invoice(invoice_id: int):
    invoice = invoice_record(invoice_id)
    if invoice["state"] == "cancel":
        raise HTTPException(400, "A cancelled invoice cannot be posted.")
    if invoice["state"] == "draft":
        odoo.execute("account.move", "action_post", [[invoice_id]])
    refreshed = invoice_record(invoice_id)
    return {"invoice_id": invoice_id, "state": refreshed["state"],
            "amount_residual": refreshed["amount_residual"], "payment_state": refreshed["payment_state"]}


@router.get("/{invoice_id}/print-link")
def invoice_print_link(invoice_id: int):
    invoice_record(invoice_id, include_refunds=True)
    return {"url": f"/api/backend/invoices/{invoice_id}/document"}


@router.get("/{invoice_id}/document")
def invoice_document(invoice_id: int):
    invoice_record(invoice_id, include_refunds=True)
    return Response(odoo.document("account.report_invoice_with_payments", invoice_id), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="invoice-{invoice_id}.pdf"'})
