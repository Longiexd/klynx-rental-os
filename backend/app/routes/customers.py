from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.odoo_client import odoo
from app.core.documents import CUSTOMER_KINDS, document_router
from app.verticals.car_rental.crm_journey import customer_documents_saved


router = APIRouter(
    prefix="/customers",
    tags=["Customers"],
)
router.include_router(document_router("res.partner", CUSTOMER_KINDS, after_save=customer_documents_saved))


# ============================================================
# SCHEMAS
# ============================================================

class CustomerCreate(BaseModel):
    name: str
    phone: str | None = None
    email: str | None = None
    description: str | None = None


class CustomerContactUpdate(BaseModel):
    phone: str | None = None
    email: str | None = None


# ============================================================
# HELPERS
# ============================================================

def clean_number(value):
    """
    Prevent None values from reaching the frontend.
    """
    return value if isinstance(value, (int, float)) else 0


def many2one_id(value):
    """
    Safely extract an Odoo many2one ID.
    """
    if isinstance(value, list) and len(value) >= 1:
        return value[0]

    return None


def many2one_name(value):
    """
    Safely extract an Odoo many2one display name.
    """
    if isinstance(value, list) and len(value) >= 2:
        return value[1]

    return None


def get_stage_status(stage_name: str | None):
    """
    Convert Odoo CRM stages into Rental OS rental statuses.

    Odoo remains the source of truth for the CRM stage.
    Rental OS only derives a simplified rental status
    for dashboard presentation.
    """

    if not stage_name:
        return None

    value = stage_name.lower().strip()

    # --------------------------------------------------------
    # Réservation confirmée -> Réservé
    # --------------------------------------------------------

    if (
        "réservation" in value
        and "confirm" in value
    ) or (
        "reservation" in value
        and "confirm" in value
    ):
        return "Réservé"

    # --------------------------------------------------------
    # Véhicule remis -> Loué
    # --------------------------------------------------------

    if (
        "véhicule remis" in value
        or "vehicule remis" in value
    ):
        return "Loué"

    # --------------------------------------------------------
    # Other CRM stages remain CRM-only
    # --------------------------------------------------------

    return None


# ============================================================
# INVOICES
# ============================================================

def get_customer_invoices(partner_id: int):

    invoices = odoo.execute(
        "account.move",
        "search_read",
        [
            [
                ["partner_id", "=", partner_id],
                [
                    "move_type",
                    "in",
                    [
                        "out_invoice",
                        "out_refund",
                    ],
                ],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "state",
                "move_type",
                "invoice_date",
                "invoice_date_due",
                "amount_total",
                "amount_residual",
                "payment_state",
                "invoice_origin",
            ],
            "order": "id desc",
            "limit": 100,
        },
    )

    result = []

    for invoice in invoices:

        result.append(
            {
                "id": invoice["id"],

                "name": invoice.get("name"),

                "state": invoice.get("state"),

                "move_type":
                    invoice.get("move_type"),

                "amount_total":
                    clean_number(
                        invoice.get("amount_total")
                    ),

                "amount_residual":
                    clean_number(
                        invoice.get("amount_residual")
                    ),

                "payment_state":
                    invoice.get("payment_state")
                    or "not_paid",

                "invoice_date":
                    invoice.get("invoice_date"),

                "due_date":
                    invoice.get(
                        "invoice_date_due"
                    ),

                "origin":
                    invoice.get(
                        "invoice_origin"
                    ),
            }
        )

    return result


# ============================================================
# SALES
# ============================================================

def get_customer_sales(partner_id: int):

    orders = odoo.execute(
        "sale.order",
        "search_read",
        [
            [
                ["partner_id", "=", partner_id],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "amount_total",
                "state",
                "invoice_status",
                "date_order",
                "user_id",
            ],
            "order": "id desc",
            "limit": 100,
        },
    )

    result = []

    for order in orders:

        salesperson = order.get("user_id")

        result.append(
            {
                "id": order["id"],

                "name": order["name"],

                "amount_total":
                    clean_number(
                        order.get(
                            "amount_total"
                        )
                    ),

                "state":
                    order.get("state"),

                "invoice_status":
                    order.get(
                        "invoice_status"
                    ),

                "date_order":
                    order.get(
                        "date_order"
                    ),

                "salesperson": (
                    many2one_name(
                        salesperson
                    )
                ),

                "salesperson_id": (
                    many2one_id(
                        salesperson
                    )
                ),
            }
        )

    return result


# ============================================================
# GET CUSTOMERS
# ============================================================

@router.get("")
def get_customers():

    # --------------------------------------------------------
    # IMPORTANT
    #
    # We intentionally START from crm.lead.
    #
    # Therefore:
    #
    # res.partner alone != Rental OS customer
    #
    # A contact only becomes a Rental OS customer when it
    # has been connected to CRM.
    # --------------------------------------------------------

    leads = odoo.execute(
        "crm.lead",
        "search_read",
        [
            [
                ["partner_id", "!=", False],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "partner_id",
                "phone",
                "email_from",
                "stage_id",
                "user_id",
                "description",
                "expected_revenue",
                "probability",
                "create_date",
                "write_date",
            ],
            "order": "id desc",
            "limit": 500,
        },
    )

    if not leads:
        return {
            "count": 0,
            "customers": [],
        }

    # --------------------------------------------------------
    # Keep the latest CRM lead for every partner
    # --------------------------------------------------------

    latest_leads = {}

    for lead in leads:

        partner_id = many2one_id(
            lead.get("partner_id")
        )

        if not partner_id:
            continue

        if partner_id not in latest_leads:
            latest_leads[partner_id] = lead

    partner_ids = list(
        latest_leads.keys()
    )

    if not partner_ids:
        return {
            "count": 0,
            "customers": [],
        }

    # --------------------------------------------------------
    # Fetch actual res.partner records
    # --------------------------------------------------------

    partners = odoo.execute(
        "res.partner",
        "search_read",
        [
            [
                ["id", "in", partner_ids],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "phone",
                "email",
                "street",
                "street2",
                "city",
                "zip",
                "country_id",
                "company_name",
                "vat",
            ],
        },
    )

    partner_map = {
        partner["id"]: partner
        for partner in partners
    }

    # --------------------------------------------------------
    # BUILD CUSTOMER LIST
    # --------------------------------------------------------

    result = []

    for partner_id, lead in latest_leads.items():

        partner = partner_map.get(
            partner_id
        )

        if not partner:
            continue

        # ----------------------------------------------------
        # CRM STAGE
        # ----------------------------------------------------

        stage = lead.get("stage_id")

        stage_id = many2one_id(stage)
        stage_name = many2one_name(stage)

        # ----------------------------------------------------
        # SALESPERSON
        # ----------------------------------------------------

        salesperson = lead.get(
            "user_id"
        )

        salesperson_id = many2one_id(
            salesperson
        )

        salesperson_name = many2one_name(
            salesperson
        )

        # ----------------------------------------------------
        # SALES
        # ----------------------------------------------------

        sales_orders = get_customer_sales(
            partner_id
        )

        sales_total = sum(
            clean_number(
                order.get(
                    "amount_total"
                )
            )
            for order in sales_orders
        )

        # ----------------------------------------------------
        # INVOICES
        # ----------------------------------------------------

        invoices = get_customer_invoices(
            partner_id
        )

        invoice_total = sum(
            clean_number(
                invoice.get(
                    "amount_total"
                )
            )
            for invoice in invoices
        )

        outstanding_amount = sum(
            clean_number(
                invoice.get(
                    "amount_residual"
                )
            )
            for invoice in invoices
        )

        paid_invoices = sum(
            1
            for invoice in invoices
            if invoice.get(
                "payment_state"
            ) in [
                "paid",
                "in_payment",
            ]
        )

        unpaid_invoices = sum(
            1
            for invoice in invoices
            if invoice.get(
                "payment_state"
            ) not in [
                "paid",
                "in_payment",
            ]
        )

        # ----------------------------------------------------
        # PAYMENT STATUS
        # ----------------------------------------------------

        if not invoices:

            payment_status = "no_invoice"

        elif outstanding_amount <= 0:

            payment_status = "paid"

        else:

            payment_status = "unpaid"

        # ----------------------------------------------------
        # RENTAL STATUS
        # ----------------------------------------------------

        rental_status = get_stage_status(
            stage_name
        )

        # ----------------------------------------------------
        # CUSTOMER
        # ----------------------------------------------------

        result.append(
            {
                # ------------------------------------------------
                # RES.PARTNER
                # ------------------------------------------------

                "id":
                    partner["id"],

                "partner_id":
                    partner["id"],

                "name":
                    partner["name"],

                "phone":
                    partner.get("phone"),

                "email":
                    partner.get("email"),

                # ------------------------------------------------
                # CRM
                # ------------------------------------------------

                "crm_stage":
                    stage_name,

                "crm_stage_id":
                    stage_id,

                "salesperson":
                    salesperson_name,

                "salesperson_id":
                    salesperson_id,

                "lead_id":
                    lead["id"],

                "lead_name":
                    lead.get("name"),

                "description":
                    lead.get("description"),

                "expected_revenue":
                    clean_number(
                        lead.get(
                            "expected_revenue"
                        )
                    ),

                "probability":
                    clean_number(
                        lead.get(
                            "probability"
                        )
                    ),

                "created":
                    lead.get(
                        "create_date"
                    ),

                "updated":
                    lead.get(
                        "write_date"
                    ),

                "lead_count":
                    1,

                # ------------------------------------------------
                # RENTAL
                # ------------------------------------------------

                "rental_status":
                    rental_status,

                # ------------------------------------------------
                # SALES
                # ------------------------------------------------

                "sales_count":
                    len(sales_orders),

                "sales_total":
                    sales_total,

                "sales_orders":
                    sales_orders,

                # ------------------------------------------------
                # INVOICES
                # ------------------------------------------------

                "invoice_count":
                    len(invoices),

                "invoice_total":
                    invoice_total,

                "outstanding_amount":
                    outstanding_amount,

                "paid_invoices":
                    paid_invoices,

                "unpaid_invoices":
                    unpaid_invoices,

                "payment_status":
                    payment_status,

                # IMPORTANT:
                # Always return an array.
                # Never undefined.

                "invoice_ids": [
                    invoice["id"]
                    for invoice in invoices
                ],

                "invoices":
                    invoices,
            }
        )

    return {
        "count": len(result),
        "customers": result,
    }


# ============================================================
# SEARCH CUSTOMERS (duplicate detection)
# ============================================================

@router.get("/search")
def search_customers(q: str = ""):
    """
    Search ALL res.partner contacts by name — not just the ones
    already linked to a CRM lead. Used by the "Add customer"
    flow on the frontend: before creating a brand-new contact,
    we check whether a similar contact already exists so the
    user can attach a new opportunity to it instead of creating
    a duplicate res.partner.
    """

    query = (q or "").strip()

    if not query:
        return {
            "count": 0,
            "matches": [],
        }

    partners = odoo.execute(
        "res.partner",
        "search_read",
        [
            [
                ["name", "ilike", query],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "phone",
                "email",
            ],
            "limit": 8,
        },
    )

    if not partners:
        return {
            "count": 0,
            "matches": [],
        }

    partner_ids = [p["id"] for p in partners]

    # Figure out which of these matches are already "customers"
    # (i.e. already have a linked crm.lead), so the frontend can
    # word the suggestion accordingly.

    linked_leads = odoo.execute(
        "crm.lead",
        "search_read",
        [
            [
                ["partner_id", "in", partner_ids],
            ]
        ],
        {
            "fields": [
                "partner_id",
            ],
        },
    )

    linked_partner_ids = {
        many2one_id(lead.get("partner_id"))
        for lead in linked_leads
        if lead.get("partner_id")
    }

    matches = [
        {
            "id": partner["id"],
            "name": partner["name"],
            "phone": partner.get("phone"),
            "email": partner.get("email"),
            "is_customer": partner["id"] in linked_partner_ids,
        }
        for partner in partners
    ]

    return {
        "count": len(matches),
        "matches": matches,
    }


# ============================================================
# GET CUSTOMER
# ============================================================

@router.get("/{partner_id}")
def get_customer(partner_id: int):

    # --------------------------------------------------------
    # CRM LEADS
    # --------------------------------------------------------

    leads = odoo.execute(
        "crm.lead",
        "search_read",
        [
            [
                ["partner_id", "=", partner_id],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "partner_id",
                "phone",
                "email_from",
                "stage_id",
                "user_id",
                "description",
                "expected_revenue",
                "probability",
                "create_date",
                "write_date",
            ],
            "order": "id desc",
        },
    )

    if not leads:

        raise HTTPException(
            status_code=404,
            detail=(
                "Customer is not connected "
                "to CRM."
            ),
        )

    lead = leads[0]

    # --------------------------------------------------------
    # PARTNER
    # --------------------------------------------------------

    partners = odoo.execute(
        "res.partner",
        "search_read",
        [
            [
                ["id", "=", partner_id],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "phone",
                "email",
                "street",
                "street2",
                "city",
                "zip",
                "country_id",
                "company_name",
                "vat",
            ],
        },
    )

    if not partners:

        raise HTTPException(
            status_code=404,
            detail=(
                "Customer contact not found."
            ),
        )

    partner = partners[0]

    # --------------------------------------------------------
    # CRM
    # --------------------------------------------------------

    stage = lead.get(
        "stage_id"
    )

    stage_id = many2one_id(stage)
    stage_name = many2one_name(stage)

    salesperson = lead.get(
        "user_id"
    )

    salesperson_id = many2one_id(
        salesperson
    )

    salesperson_name = many2one_name(
        salesperson
    )

    # --------------------------------------------------------
    # SALES
    # --------------------------------------------------------

    sales_orders = get_customer_sales(
        partner_id
    )

    sales_total = sum(
        clean_number(
            order.get(
                "amount_total"
            )
        )
        for order in sales_orders
    )

    # --------------------------------------------------------
    # INVOICES
    # --------------------------------------------------------

    invoices = get_customer_invoices(
        partner_id
    )

    invoice_total = sum(
        clean_number(
            invoice.get(
                "amount_total"
            )
        )
        for invoice in invoices
    )

    outstanding_amount = sum(
        clean_number(
            invoice.get(
                "amount_residual"
            )
        )
        for invoice in invoices
    )

    paid_invoices = sum(
        1
        for invoice in invoices
        if invoice.get(
            "payment_state"
        ) in [
            "paid",
            "in_payment",
        ]
    )

    unpaid_invoices = sum(
        1
        for invoice in invoices
        if invoice.get(
            "payment_state"
        ) not in [
            "paid",
            "in_payment",
        ]
    )

    # --------------------------------------------------------
    # PAYMENT STATUS
    # --------------------------------------------------------

    if not invoices:

        payment_status = "no_invoice"

    elif outstanding_amount <= 0:

        payment_status = "paid"

    else:

        payment_status = "unpaid"

    # --------------------------------------------------------
    # RETURN COMPLETE CUSTOMER
    # --------------------------------------------------------

    return {
        # ----------------------------------------------------
        # PARTNER
        # ----------------------------------------------------

        "id":
            partner["id"],

        "partner_id":
            partner["id"],

        "name":
            partner["name"],

        "phone":
            partner.get("phone"),

        "email":
            partner.get("email"),

        "address": {
            "street":
                partner.get(
                    "street"
                ),

            "street2":
                partner.get(
                    "street2"
                ),

            "city":
                partner.get(
                    "city"
                ),

            "zip":
                partner.get(
                    "zip"
                ),

            "country": (
                many2one_name(
                    partner.get(
                        "country_id"
                    )
                )
            ),
        },

        "company_name":
            partner.get(
                "company_name"
            ),

        "vat":
            partner.get("vat"),

        # ----------------------------------------------------
        # CRM
        # ----------------------------------------------------

        "crm_stage":
            stage_name,

        "crm_stage_id":
            stage_id,

        "rental_status":
            get_stage_status(
                stage_name
            ),

        "salesperson":
            salesperson_name,

        "salesperson_id":
            salesperson_id,

        "lead_id":
            lead["id"],

        "lead_name":
            lead.get("name"),

        "description":
            lead.get("description"),

        "expected_revenue":
            clean_number(
                lead.get(
                    "expected_revenue"
                )
            ),

        "probability":
            clean_number(
                lead.get(
                    "probability"
                )
            ),

        "created":
            lead.get(
                "create_date"
            ),

        "updated":
            lead.get(
                "write_date"
            ),

        # ----------------------------------------------------
        # COMPLETE CRM HISTORY
        # ----------------------------------------------------

        "lead_history": [
            {
                "id":
                    item["id"],

                "name":
                    item["name"],

                "stage":
                    many2one_name(
                        item.get(
                            "stage_id"
                        )
                    ),

                "stage_id":
                    many2one_id(
                        item.get(
                            "stage_id"
                        )
                    ),

                "salesperson":
                    many2one_name(
                        item.get(
                            "user_id"
                        )
                    ),

                "salesperson_id":
                    many2one_id(
                        item.get(
                            "user_id"
                        )
                    ),

                "description":
                    item.get(
                        "description"
                    ),

                "expected_revenue":
                    clean_number(
                        item.get(
                            "expected_revenue"
                        )
                    ),

                "probability":
                    clean_number(
                        item.get(
                            "probability"
                        )
                    ),

                "created":
                    item.get(
                        "create_date"
                    ),
            }
            for item in leads
        ],

        # ----------------------------------------------------
        # SALES
        # ----------------------------------------------------

        "sales_count":
            len(sales_orders),

        "sales_total":
            sales_total,

        "sales_orders":
            sales_orders,

        # ----------------------------------------------------
        # INVOICES
        # ----------------------------------------------------

        "invoice_count":
            len(invoices),

        "invoice_total":
            invoice_total,

        "outstanding_amount":
            outstanding_amount,

        "paid_invoices":
            paid_invoices,

        "unpaid_invoices":
            unpaid_invoices,

        "payment_status":
            payment_status,

        # IMPORTANT:
        # Always an array.

        "invoice_ids": [
            invoice["id"]
            for invoice in invoices
        ],

        "invoices":
            invoices,
    }


# ============================================================
# CREATE CUSTOMER
# ============================================================

@router.post("")
def create_customer(customer: CustomerCreate):

    # --------------------------------------------------------
    # 1. CREATE RES.PARTNER
    # --------------------------------------------------------

    partner_id = odoo.execute(
        "res.partner",
        "create",
        [
            {
                "name": customer.name,
                "phone": customer.phone,
                "email": customer.email,
            }
        ],
    )

    # --------------------------------------------------------
    # 2. CREATE CRM LEAD
    #
    # The CRM lead references the res.partner.
    # This is what makes the contact visible in Rental OS.
    # --------------------------------------------------------

    lead_id = odoo.execute(
        "crm.lead",
        "create",
        [
            {
                "name": customer.name,
                "partner_id": partner_id,
                "phone": customer.phone,
                "email_from": customer.email,
                "description": customer.description,
            }
        ],
    )

    return {
        "success": True,
        "partner_id": partner_id,
        "lead_id": lead_id,
    }


@router.patch("/{partner_id}")
def update_customer_contact(partner_id: int, data: CustomerContactUpdate):
    """
    Lets an agent add/correct a phone or email after the contact was
    already saved — previously the only way in was at creation time.
    Propagates to any open CRM leads for the same partner so the
    prospect record doesn't go stale next to the updated contact.
    """
    values = {}
    if data.phone is not None:
        values["phone"] = data.phone.strip() or False
    if data.email is not None:
        values["email"] = data.email.strip() or False

    if not values:
        raise HTTPException(400, "Provide a phone and/or email to update.")

    odoo.execute("res.partner", "write", [[partner_id], values])

    lead_values = {}
    if "phone" in values:
        lead_values["phone"] = values["phone"]
    if "email" in values:
        lead_values["email_from"] = values["email"]

    if lead_values:
        lead_ids = odoo.execute(
            "crm.lead", "search",
            [[["partner_id", "=", partner_id], ["active", "=", True]]],
        )
        if lead_ids:
            odoo.execute("crm.lead", "write", [lead_ids, lead_values])

    return {"success": True}
