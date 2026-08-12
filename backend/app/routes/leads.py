from fastapi import APIRouter
from app.odoo_client import odoo


router = APIRouter(
    prefix="/leads",
    tags=["CRM"]
)


@router.get("")
def get_leads():

    leads = odoo.execute(
        "crm.lead",
        "search_read",
        [],
        {
            "fields":[
                "name",
                "partner_id",
                "phone",
                "email_from",
                "stage_id",
                "create_date"
            ]
        }
    )


    result=[]

    for lead in leads:

        result.append({

            "id": lead["id"],

            "name": lead["name"],

            "customer":
                lead["partner_id"][1]
                if lead["partner_id"]
                else None,

            "phone": lead["phone"],

            "email": lead["email_from"],

            "stage":
                lead["stage_id"][1]
                if lead["stage_id"]
                else None,

            "created": lead["create_date"]

        })


    return {
        "count":len(result),
        "leads":result
    }