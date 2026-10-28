from datetime import date
from html import escape
import unicodedata
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.odoo_client import odoo

router = APIRouter(prefix="/activities", tags=["Activities"])


class ActivityCreate(BaseModel):
    lead_id: int | None = Field(default=None, gt=0)
    sale_id: int | None = Field(default=None, gt=0)
    activity_type_id: int = Field(gt=0)
    summary: str = Field(min_length=1, max_length=250)
    date_deadline: date
    note: str = Field(default="", max_length=10000)


class ActivityComplete(BaseModel):
    feedback: str = Field(default="", max_length=10000)


class ActivityReschedule(BaseModel):
    date_deadline: date


def read(model, domain, fields, **kwargs):
    return odoo.execute(
        model, "search_read", [domain], {"fields": fields, **kwargs}
    )


@router.get("/types")
def activity_types(res_model: Literal["crm.lead", "sale.order"] = "crm.lead"):
    return {
        "types": read(
            "mail.activity.type",
            [
                "&",
                "|",
                ["res_model", "=", False],
                ["res_model", "=", res_model],
                "|",
                ["category", "=", "phonecall"],
                ["icon", "=", "fa-envelope"],
            ],
            ["id", "name", "category"],
            order="sequence, id",
        )
    }


@router.get("")
def list_activities(
    lead_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sale_id: int | None = None,
):
    domain = [
        ["res_model", "in", ["crm.lead", "sale.order"]],
        ["active", "=", True],
        "|",
        ["activity_type_id.category", "=", "phonecall"],
        ["activity_type_id.icon", "=", "fa-envelope"],
    ]
    if lead_id:
        domain.extend([
            ["res_model", "=", "crm.lead"],
            ["res_id", "=", lead_id],
        ])
    if sale_id:
        domain.extend([
            ["res_model", "=", "sale.order"],
            ["res_id", "=", sale_id],
        ])
    if date_from:
        domain.append(["date_deadline", ">=", date_from.isoformat()])
    if date_to:
        domain.append(["date_deadline", "<=", date_to.isoformat()])

    activities = read(
        "mail.activity",
        domain,
        [
            "id", "res_id", "res_model", "res_name", "summary",
            "note", "date_deadline", "activity_type_id",
            "activity_category", "user_id", "state",
        ],
        order="date_deadline, id",
    )
    return {"activities": activities, "count": len(activities)}


@router.post("")
def create_activity(data: ActivityCreate):
    if not data.summary.strip():
        raise HTTPException(400, "Activity title is required.")
    if data.date_deadline < date.today():
        raise HTTPException(422, "Due date cannot be in the past.")
    if bool(data.lead_id) == bool(data.sale_id):
        raise HTTPException(
            422,
            "Choose exactly one prospect or booking for this call/email.",
        )

    model, record_id = (
        ("crm.lead", data.lead_id)
        if data.lead_id
        else ("sale.order", data.sale_id)
    )

    if not read(model, [["id", "=", record_id]], ["id"], limit=1):
        raise HTTPException(404, "Related record not found.")

    types = activity_types(model)["types"]
    if not any(item["id"] == data.activity_type_id for item in types):
        raise HTTPException(
            400, "Choose an available Call or Email activity type."
        )

    # Odoo resolves its technical model internally through activity defaults.
    # The operator does not need direct read access to ir.model.
    defaults = odoo.execute(
        "mail.activity",
        "default_get",
        [["res_model", "res_model_id"]],
        {"context": {"default_res_model": model}},
    )
    model_id = (defaults or {}).get("res_model_id")
    if not model_id:
        raise HTTPException(
            409, "Activity scheduling is unavailable right now."
        )

    values = {
        "res_model_id": model_id,
        "res_id": record_id,
        "activity_type_id": data.activity_type_id,
        "summary": data.summary.strip(),
        "date_deadline": data.date_deadline.isoformat(),
        "note": escape(data.note).replace("\n", "<br/>"),
    }
    activity_id = odoo.execute("mail.activity", "create", [values])
    return {"success": True, "activity_id": activity_id}


@router.patch("/{activity_id}")
def reschedule_activity(activity_id: int, data: ActivityReschedule):
    """
    Changes the due date on Odoo's native activity record.
    """
    if data.date_deadline < date.today():
        raise HTTPException(
            422, "Due date cannot be moved into the past."
        )

    activities = read(
        "mail.activity",
        [
            ["id", "=", activity_id],
            ["res_model", "in", ["crm.lead", "sale.order"]],
            ["active", "=", True],
        ],
        ["id"],
        limit=1,
    )
    if not activities:
        raise HTTPException(
            404,
            "Activity is already completed or unavailable. Refresh the list.",
        )

    odoo.execute(
        "mail.activity",
        "write",
        [[activity_id], {"date_deadline": data.date_deadline.isoformat()}],
    )
    return {"success": True}


def contacted_stage(lead):
    stages = read(
        "crm.stage",
        [
            "|",
            ["team_id", "=", False],
            [
                "team_id",
                "=",
                lead["team_id"][0] if lead.get("team_id") else False,
            ],
        ],
        ["id", "name", "sequence", "is_won"],
    )

    def normalize(value):
        return (
            unicodedata.normalize("NFKD", value)
            .encode("ascii", "ignore")
            .decode()
            .lower()
            .strip()
        )

    matches = [
        stage
        for stage in stages
        if normalize(stage["name"]) in ("contacte", "contacted")
    ]
    if len(matches) != 1:
        return None

    target = matches[0]
    current_id = lead["stage_id"][0] if lead.get("stage_id") else None
    current = next(
        (stage for stage in stages if stage["id"] == current_id), None
    )
    if current and (
        current["is_won"]
        or current["sequence"] >= target["sequence"]
    ):
        return None

    return target


@router.post("/{activity_id}/complete")
def complete_activity(activity_id: int, data: ActivityComplete):
    activities = read(
        "mail.activity",
        [
            ["id", "=", activity_id],
            ["res_model", "in", ["crm.lead", "sale.order"]],
            ["active", "=", True],
        ],
        ["res_id", "res_model", "activity_category"],
        limit=1,
    )
    if not activities:
        raise HTTPException(
            404,
            "Activity is already completed or unavailable. Refresh the list.",
        )

    activity = activities[0]
    stage = None
    warning = None

    if (
        activity.get("res_model") == "crm.lead"
        and activity.get("activity_category") == "phonecall"
    ):
        leads = read(
            "crm.lead",
            [["id", "=", activity["res_id"]]],
            ["id", "team_id", "stage_id"],
            limit=1,
        )
        if leads:
            stage = contacted_stage(leads[0])
            if not stage:
                warning = (
                    "Call completed. CRM stage kept: already contacted/later, "
                    "or no unique Contacté stage is configured."
                )

    odoo.execute(
        "mail.activity",
        "action_feedback",
        [[activity_id]],
        {"feedback": escape(data.feedback) if data.feedback else False},
    )

    if stage:
        try:
            if not odoo.execute(
                "crm.lead",
                "write",
                [[activity["res_id"]], {"stage_id": stage["id"]}],
            ):
                raise RuntimeError("Stage update failed")
        except Exception:
            warning = (
                "Activity completed, but CRM stage could not be updated. "
                "Open the prospect to update its stage."
            )

    return {"success": True, "warning": warning}