from fastapi import APIRouter
from app.odoo_client import odoo


router = APIRouter(
    prefix="/customers",
    tags=["Customers"]
)


@router.get("")
def get_customers():

    customers = odoo.execute(
        "res.partner",
        "search_read",
        [],
        {
            "fields":[
                "name",
                "phone",
                "email",
                "mobile"
            ]
        }
    )


    return {
        "count": len(customers),
        "customers": customers
    }