from fastapi import APIRouter
from app.odoo_client import odoo


router = APIRouter(
    prefix="/cars",
    tags=["Cars"]
)


@router.get("")
def get_cars():

    vehicles = odoo.execute(
        "fleet.vehicle",
        "search_read",
        [],
        {
            "fields": [
                "name",
                "license_plate",
                "model_id",
                "state_id"
            ]
        }
    )


    cars = []

    for vehicle in vehicles:

        cars.append({
            "id": vehicle["id"],
            "name": vehicle["name"],
            "license_plate": vehicle["license_plate"],
            "model": vehicle["model_id"][1]
                if vehicle["model_id"]
                else None,
            "status": vehicle["state_id"][1]
                if vehicle["state_id"]
                else None
        })


    return {
        "count": len(cars),
        "cars": cars
    }