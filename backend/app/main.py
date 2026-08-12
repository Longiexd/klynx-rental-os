from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.odoo_client import odoo


app = FastAPI(
    title="Klynx Rental OS API"
)


# ==========================
# CORS
# ==========================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://rental-os.example.com",
        "http://localhost:3100",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================
# ROOT
# ==========================

@app.get("/")
def root():
    return {
        "status": "Rental OS API"
    }

# ==========================
# TEST LOGIN
# ==========================

@app.get("/login")
def login():
    return {
        "uid": odoo.authenticate()
    }


# ==========================
# FLEET
# ==========================

@app.get("/cars")
def cars():

    vehicles = odoo.execute(
        "fleet.vehicle",
        "search_read",
        [],
        fields=[
            "name",
            "license_plate",
            "model_id",
            "state_id"
        ]
    )

    formatted = []

    for car in vehicles:

        formatted.append({
            "id": car["id"],
            "name": car["name"],
            "license_plate": car["license_plate"],
            "model": car["model_id"][1] if car["model_id"] else None,
            "status": car["state_id"][1] if car["state_id"] else None
        })


    return {
        "count": len(formatted),
        "cars": formatted
    }



# ==========================
# CUSTOMERS
# ==========================

@app.get("/customers")
def customers():

    partners = odoo.execute(
        "res.partner",
        "search_read",
        [],
        fields=[
            "name",
            "phone",
            "email",
            "mobile"
        ]
    )


    return {
        "count": len(partners),
        "customers": partners
    }



# ==========================
# LEADS
# ==========================

@app.get("/leads")
def leads():

    leads = odoo.execute(
        "crm.lead",
        "search_read",
        [],
        fields=[
            "name",
            "partner_id",
            "phone",
            "email_from",
            "stage_id",
            "expected_revenue"
        ]
    )


    formatted = []


    for lead in leads:

        formatted.append({

            "id": lead["id"],
            "title": lead["name"],

            "customer": (
                lead["partner_id"][1]
                if lead["partner_id"]
                else None
            ),

            "phone": lead["phone"],
            "email": lead["email_from"],

            "stage": (
                lead["stage_id"][1]
                if lead["stage_id"]
                else None
            ),

            "expected_revenue": lead["expected_revenue"]

        })


    return {
        "count": len(formatted),
        "leads": formatted
    }



# ==========================
# CREATE LEAD
# ==========================

class LeadCreate(BaseModel):

    name: str
    phone: str | None = None
    email: str | None = None
    description: str | None = None



@app.post("/leads")
def create_lead(lead: LeadCreate):


    lead_id = odoo.execute(
        "crm.lead",
        "create",
        {
            "name": lead.name,
            "phone": lead.phone,
            "email_from": lead.email,
            "description": lead.description
        }
    )


    return {
        "success": True,
        "lead_id": lead_id
    }