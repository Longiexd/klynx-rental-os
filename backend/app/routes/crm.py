from fastapi import APIRouter

from app.odoo_client import odoo


router = APIRouter(
    prefix="/crm",
    tags=["CRM"]
)


# =========================================================
# CRM OVERVIEW
# =========================================================

@router.get("")
def crm_overview():

    return {
        "status": "CRM API",
        "modules": [
            "leads",
            "stages",
            "customers",
        ]
    }


# =========================================================
# CRM STAGES (kanban columns)
# =========================================================

@router.get("/stages")
def get_stages():

    stages = odoo.execute(
        "crm.stage",
        "search_read",
        [],
        {
            "fields": [
                "id",
                "name",
                "sequence",
            ],
            "order": "sequence asc",
        },
    )

    return {
        "count": len(stages),
        "stages": stages,
    }


# =========================================================
# LEAD OPTIONS (vehicle type / brand for the "what are they
# looking for" fields on the Add Lead form)
#
# A lead doesn't have a specific fleet.vehicle assigned yet —
# it expresses a preference (category + brand), which lives on
# fleet.vehicle.model.category / fleet.vehicle.model.brand in
# Odoo. This was previously missing entirely: the frontend has
# always called GET /crm/lead-options, but no route existed for
# it, so the request silently 404'd and the form fell back to
# empty dropdowns.
# =========================================================

@router.get("/lead-options")
def get_lead_options():

    vehicle_types = odoo.execute(
        "fleet.vehicle.model.category",
        "search_read",
        [],
        {
            "fields": [
                "id",
                "name",
            ],
            "order": "name",
        },
    )

    vehicle_brands = odoo.execute(
        "fleet.vehicle.model.brand",
        "search_read",
        [],
        {
            "fields": [
                "id",
                "name",
            ],
            "order": "name",
        },
    )

    return {
        "vehicle_types": vehicle_types,
        "vehicle_brands": vehicle_brands,
    }