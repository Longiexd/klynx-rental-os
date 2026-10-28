from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.odoo_client import odoo
from app.verticals.car_rental.crm_journey import latest_rentals, safe_sync


router = APIRouter(
    prefix="/crm/leads",
    tags=["CRM Leads"],
)


@router.post("/sync-journey")
def sync_journey():
    return safe_sync()


def find_name(model: str, record_id: int) -> str | None:
    """
    Lenient lookup used only to build a readable description
    line — returns None instead of raising if the record is
    missing, since that shouldn't block lead creation.
    """

    records = odoo.execute(
        model,
        "search_read",
        [[["id", "=", record_id]]],
        {"fields": ["name"], "limit": 1},
    )

    return records[0]["name"] if records else None


# =========================================================
# SCHEMAS
# =========================================================

class LeadCreate(BaseModel):
    name: str
    partner_id: int | None = None
    opportunity_id: int | None = None
    phone: str | None = None
    email: str | None = None
    description: str | None = None
    expected_revenue: float | None = 0
    reservation_start: str | None = None
    reservation_end: str | None = None
    vehicle_type_id: int | None = None
    vehicle_brand_id: int | None = None


class StageUpdate(BaseModel):
    stage_id: int


class ContactUpdate(BaseModel):
    phone: str | None = None
    email: str | None = None


@router.get("/{lead_id}")
def get_lead(lead_id: int):
    records = odoo.execute("crm.lead", "search_read", [[["id", "=", lead_id]]],
                           {"fields": ["id", "name", "partner_id", "phone", "mobile", "email_from",
                                       "stage_id", "description", "expected_revenue"], "limit": 1,
                            "context": {"active_test": False}})
    if not records:
        raise HTTPException(404, "Prospect not found.")
    lead = records[0]
    lead["rentals"] = odoo.execute("sale.order", "search_read", [[["opportunity_id", "=", lead_id]]],
                                  {"fields": ["id", "name", "state", "amount_total"], "order": "id desc"})
    return lead


# =========================================================
# GET LEADS
# =========================================================

@router.get("")
def get_leads():

    leads = odoo.execute(
        "crm.lead",
        "search_read",
        [],
        {
            "fields": [
                "id",
                "name",
                "partner_id",
                "phone",
                "mobile",
                "email_from",
                "stage_id",
                "user_id",
                "expected_revenue",
                "create_date",
            ],
            "order": "create_date desc, id desc",
            "limit": 500,
        },
    )

    rentals = latest_rentals([lead["id"] for lead in leads])
    result = []

    for lead in leads:

        stage_id = None
        stage_name = None

        if lead.get("stage_id"):
            stage_id = lead["stage_id"][0]
            stage_name = lead["stage_id"][1]

        salesperson_id = None
        salesperson_name = None

        if lead.get("user_id"):
            salesperson_id = lead["user_id"][0]
            salesperson_name = lead["user_id"][1]

        customer = None

        if lead.get("partner_id"):
            customer = {
                "id": lead["partner_id"][0],
                "name": lead["partner_id"][1],
            }

        result.append(
            {
                "id": lead["id"],
                "name": lead["name"],

                # Customer linked to the Odoo CRM opportunity
                "customer": customer,

                # Contact information
                "phone": (
                    lead.get("phone")
                    or lead.get("mobile")
                    or None
                ),
                "email": lead.get("email_from") or None,
                "rental": ({"id": rentals[lead["id"]]["id"], "name": rentals[lead["id"]]["name"]}
                           if lead["id"] in rentals else None),

                # =================================================
                # IMPORTANT FOR KANBAN
                # =================================================
                # Return BOTH the stage ID and stage name.
                #
                # stage_id is what allows the frontend to place
                # the lead in the correct Kanban column.
                #
                # stage is used for display / color coding.
                # =================================================

                "stage_id": stage_id,
                "stage": stage_name,

                # Salesperson
                "salesperson": (
                    {
                        "id": salesperson_id,
                        "name": salesperson_name,
                    }
                    if salesperson_id is not None
                    else None
                ),

                # Revenue
                "expected_revenue": (
                    lead.get("expected_revenue") or 0
                ),

                # Creation date
                "created": lead.get("create_date"),
            }
        )

    return {
        "count": len(result),
        "leads": result,
    }


# =========================================================
# CREATE LEAD / OPPORTUNITY
# =========================================================

@router.post("")
def create_lead(lead: LeadCreate):

    name = lead.name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Opportunity name is required.",
        )

    # ---------------------------------------------------------
    # RESERVATION REQUIREMENTS
    #
    # crm.lead has no dedicated fields for these, so they're
    # appended to the description as a readable summary —
    # previously these were sent by the frontend but silently
    # dropped since LeadCreate never declared them.
    # ---------------------------------------------------------

    requirement_lines = []

    if lead.reservation_start or lead.reservation_end:
        requirement_lines.append(
            f"Requested dates: "
            f"{lead.reservation_start or '?'} "
            f"to {lead.reservation_end or '?'}"
        )

    if lead.vehicle_type_id:
        vehicle_type_name = find_name(
            "fleet.vehicle.model.category",
            lead.vehicle_type_id,
        )

        if vehicle_type_name:
            requirement_lines.append(
                f"Vehicle type: {vehicle_type_name}"
            )

    if lead.vehicle_brand_id:
        vehicle_brand_name = find_name(
            "fleet.vehicle.model.brand",
            lead.vehicle_brand_id,
        )

        if vehicle_brand_name:
            requirement_lines.append(
                f"Vehicle brand: {vehicle_brand_name}"
            )

    description = lead.description or ""

    if requirement_lines:
        description = "\n".join(
            [description, *requirement_lines]
        ).strip()

    values = {
        "name": name,
        "phone": lead.phone,
        "email_from": lead.email,
        "description": description or None,
        "expected_revenue": lead.expected_revenue or 0,
    }

    # ---------------------------------------------------------
    # LINK EXISTING CUSTOMER
    # ---------------------------------------------------------

    if lead.partner_id:

        partners = odoo.execute(
            "res.partner",
            "search_read",
            [
                [
                    ["id", "=", lead.partner_id],
                ]
            ],
            {
                "fields": [
                    "id",
                    "name",
                    "phone",
                    "email",
                ],
                "limit": 1,
            },
        )

        if not partners:
            raise HTTPException(
                status_code=404,
                detail="Customer not found.",
            )

        partner = partners[0]

        values["partner_id"] = partner["id"]

        # Keep the existing customer's contact data
        # when the opportunity does not provide its own.
        if not values["phone"]:
            values["phone"] = partner.get("phone")

        if not values["email_from"]:
            values["email_from"] = partner.get("email")

    # ---------------------------------------------------------
    # CREATE ODOO CRM OPPORTUNITY
    # ---------------------------------------------------------
    #
    # IMPORTANT:
    #
    # Odoo create() expects:
    #
    #     [values]
    #
    # and NOT:
    #
    #     values
    #
    # ---------------------------------------------------------

    if lead.opportunity_id:
        existing = odoo.execute("crm.lead", "search_read", [[["id", "=", lead.opportunity_id]]],
                                {"fields": ["partner_id", "description"], "limit": 1})
        if not existing or not lead.partner_id or (existing[0].get("partner_id") or [None])[0] != lead.partner_id:
            raise HTTPException(409, "This prospect does not belong to the selected customer.")
        lead_id = lead.opportunity_id
        if description:
            odoo.execute("crm.lead", "write", [[lead_id], {
                "description": "<br/>".join(filter(None, [existing[0].get("description"), description])),
            }])
    else:
        lead_id = odoo.execute("crm.lead", "create", [values])

    return {
        "success": True,
        "lead_id": lead_id,
        **(safe_sync([lead_id], include_unbooked=True) if not lead.opportunity_id else {}),
    }


# =========================================================
# UPDATE LEAD STAGE
# =========================================================
#
# Used by the Kanban drag & drop.
#
# The frontend sends:
#
# PATCH /crm/leads/{lead_id}/stage
#
# {
#     "stage_id": 3
# }
#
# This updates the REAL Odoo crm.lead record.
# Therefore List + Kanban + Odoo remain synchronized.
# =========================================================

@router.patch("/{lead_id}/contact")
def update_lead_contact(lead_id: int, data: ContactUpdate):
    """Adds or corrects a prospect's phone/email after the lead was
    already saved, and mirrors the change onto the linked customer
    (if any) so the two records don't drift apart."""
    values = {}
    if data.phone is not None:
        values["phone"] = data.phone.strip() or False
    if data.email is not None:
        values["email_from"] = data.email.strip() or False

    if not values:
        raise HTTPException(400, "Provide a phone and/or email to update.")

    lead = odoo.execute("crm.lead", "search_read", [[["id", "=", lead_id]]],
                         {"fields": ["partner_id"], "limit": 1})
    if not lead:
        raise HTTPException(404, "Prospect not found.")

    odoo.execute("crm.lead", "write", [[lead_id], values])

    partner_id = lead[0].get("partner_id") and lead[0]["partner_id"][0]
    if partner_id:
        partner_values = {}
        if "phone" in values:
            partner_values["phone"] = values["phone"]
        if "email_from" in values:
            partner_values["email"] = values["email_from"]
        odoo.execute("res.partner", "write", [[partner_id], partner_values])

    return {"success": True}


@router.patch("/{lead_id}/stage")
def update_lead_stage(
    lead_id: int,
    stage: StageUpdate,
):

    # ---------------------------------------------------------
    # Make sure the lead exists
    # ---------------------------------------------------------

    existing = odoo.execute(
        "crm.lead",
        "search_read",
        [
            [
                ["id", "=", lead_id],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "stage_id",
            ],
            "limit": 1,
        },
    )

    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Lead not found.",
        )

    # ---------------------------------------------------------
    # Make sure the Odoo CRM stage exists
    # ---------------------------------------------------------

    stages = odoo.execute(
        "crm.stage",
        "search_read",
        [
            [
                ["id", "=", stage.stage_id],
            ]
        ],
        {
            "fields": [
                "id",
                "name",
                "sequence",
            ],
            "limit": 1,
        },
    )

    if not stages:
        raise HTTPException(
            status_code=404,
            detail="CRM stage not found.",
        )

    # ---------------------------------------------------------
    # Update the actual Odoo CRM opportunity
    # ---------------------------------------------------------

    updated = odoo.execute(
        "crm.lead",
        "write",
        [
            [lead_id],
            {
                "stage_id": stage.stage_id,
            },
        ],
    )

    if not updated:
        raise HTTPException(
            status_code=500,
            detail="Could not update the prospect stage.",
        )

    # ---------------------------------------------------------
    # Return the updated stage
    # ---------------------------------------------------------

    return {
        "success": True,
        "lead_id": lead_id,
        "stage": {
            "id": stages[0]["id"],
            "name": stages[0]["name"],
            "sequence": stages[0]["sequence"],
        },
    }
