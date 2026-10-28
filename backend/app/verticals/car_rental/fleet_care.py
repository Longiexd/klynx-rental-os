"""Tenant-scoped fleet reminders; no customer activities or fleet states are mutated."""
from datetime import date
from collections import defaultdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.odoo_client import odoo
from app.features import enabled
from app.core.documents import checklist_from_records, parent, expiry_reminder
from app.core.record_metadata import read_metadata
from app.verticals.car_rental.states import normalize_state
from app.verticals.car_rental.fleet_records import (
    fleet_records, contract_kind, document_needs_link, apply_contract_dates, save_native_plan, sync_saved_contracts, SERVICE_MODEL,
)

from app.verticals.car_rental.eligibility import KINDS, evaluate

router = APIRouter()
OPTIONAL = {"lease", "service_contract"}
KEY = "fleet_care"


class MaintenancePlan(BaseModel):
    next_odometer: float | None = Field(default=None, ge=0, le=100000000, allow_inf_nan=False)
    next_date: date | None = None
    reminder_distance: float = Field(default=500, ge=0, le=1000000, allow_inf_nan=False)


def plan_from_record(record):
    value = read_metadata(record.get("description"), KEY)
    if not value or value.get("version") != 1:
        raise ValueError("Invalid maintenance plan")
    return MaintenancePlan.model_validate(value).model_dump(mode="json")


def vehicle_attention(vehicle, records, plan=None, today=None, contracts=None, services=None):
    today = today or date.today()
    alerts = []
    checklist = checklist_from_records(records, KINDS)
    contracts, services = contracts or [], services or []
    needs_link = any(document_needs_link(doc, contracts) for doc in checklist["documents"])
    apply_contract_dates(checklist, contracts, today)
    for contract in contracts:
        kind = contract_kind(contract)
        if contract["state"] == "closed":
            continue
        expiry = contract.get("expiration_date") or None
        has_scan = any(doc["kind"] == kind and doc["id"] for doc in checklist["documents"])
        if not has_scan and expiry and expiry_reminder(date.fromisoformat(expiry)) <= today.isoformat():
            alerts.append({"kind": "contract", "reason": "expired" if expiry < today.isoformat() else "renewal",
                           "severity": "danger" if expiry < today.isoformat() else "warning", "date": expiry,
                           "label": contract["name"], "record_id": contract["id"]})
    for doc in checklist["documents"]:
        if doc["kind"] in OPTIONAL and not doc["id"]:
            continue
        state = doc["status"]
        if state in {"missing", "expired", "uploaded"}:
            alerts.append({"kind": doc["kind"], "reason": state, "severity": "warning" if state == "uploaded" else "danger",
                           "date": doc["expiry_date"]})
        if doc["expiry_date"] and today.isoformat() <= doc["expiry_date"] and doc["reminder_date"] <= today.isoformat():
            alerts.append({"kind": doc["kind"], "reason": "renewal", "severity": "warning", "date": doc["expiry_date"]})
        if doc["id"] and doc["kind"] in {"insurance", "technical_inspection", *OPTIONAL} and not doc["expiry_date"]:
            alerts.append({"kind": doc["kind"], "reason": "date_missing", "severity": "warning", "date": None})
    eligibility = evaluate(checklist["documents"], today=today) if enabled("fleet_compliance") else {"eligible": True, "blocking_reasons": []}
    for block in eligibility["blocking_reasons"]:
        matching = next((alert for alert in alerts if alert["kind"] == block["kind"] and alert["reason"] == block["reason"]), None)
        if matching:
            matching["severity"] = "danger"
        else:
            alerts.append(block)
    odometer = vehicle.get("odometer") or 0
    state = vehicle["state_id"][1] if vehicle.get("state_id") else ""
    if any(word in normalize_state(state) for word in ("maintenance", "entretien", "repair", "repar")):
        alerts.append({"kind": "maintenance", "reason": "in_progress", "severity": "warning", "date": None})
    for service in services:
        if service["state"] not in {"new", "running"} or read_metadata(service.get("notes"), KEY):
            continue
        due = not service.get("date") or service["date"] <= today.isoformat()
        alerts.append({"kind": "service", "reason": "due" if due else "planned", "severity": "danger" if due else "warning",
                       "date": service.get("date") or None, "label": service.get("description") or service["service_type_id"][1], "record_id": service["id"]})
    if plan:
        remaining = None if plan["next_odometer"] is None else plan["next_odometer"] - odometer
        due = bool((remaining is not None and remaining <= 0) or (plan["next_date"] and plan["next_date"] <= today.isoformat()))
        soon = bool((remaining is not None and remaining <= plan["reminder_distance"]) or
                    (plan["next_date"] and (date.fromisoformat(plan["next_date"]) - today).days <= 30))
        if due or soon:
            alerts.append({"kind": "oil_change", "reason": "due" if due else "soon", "severity": "danger" if due else "warning",
                           "date": plan["next_date"], "remaining": remaining})
    return {"id": vehicle["id"], "name": vehicle.get("name") or "", "plate": vehicle.get("license_plate") or "",
            "state": state, "odometer": odometer,
            "unit": vehicle.get("odometer_unit") or "kilometers", "plan": plan, "documents": checklist["documents"],
            "alerts": alerts, "contracts": contracts, "services": services,
            "needs_contract_link": needs_link, **eligibility,
            "missing_count": sum(doc["status"] == "missing" and doc["kind"] not in OPTIONAL for doc in checklist["documents"])}


@router.get("/care")
def fleet_care():
    vehicles = odoo.execute("fleet.vehicle", "search_read", [[["active", "=", True]]],
                            {"fields": ["id", "name", "license_plate", "state_id", "odometer", "odometer_unit"], "order": "name"})
    if not vehicles:
        return {"vehicles": []}
    records = odoo.execute("ir.attachment", "search_read", [[
        ["res_model", "=", "fleet.vehicle"], ["res_id", "in", [v["id"] for v in vehicles]], ["public", "=", False], ["type", "=", "binary"],
        "|", ["description", "ilike", "[Klynx metadata:document:"], ["description", "ilike", "[Klynx metadata:fleet_care:"],
    ]], {"fields": ["id", "res_id", "name", "description", "checksum"], "order": "id desc"})
    documents, plans = defaultdict(list), {}
    invalid = set()
    for record in records:
        if "[Klynx metadata:fleet_care:" in (record.get("description") or ""):
            if record["res_id"] not in plans:
                try:
                    plans[record["res_id"]] = plan_from_record(record)
                except (ValueError, TypeError):
                    invalid.add(record["res_id"])
                    plans[record["res_id"]] = None
        else:
            documents[record["res_id"]].append(record)
    contract_rows, service_rows = fleet_records([v["id"] for v in vehicles])
    contracts, services = defaultdict(list), defaultdict(list)
    for record in contract_rows:
        contracts[record["vehicle_id"][0]].append(record)
    native_plans = set()
    for record in service_rows:
        vehicle_id = record["vehicle_id"][0]
        services[vehicle_id].append(record)
        if "[Klynx metadata:fleet_care:" in (record.get("notes") or "") and vehicle_id not in native_plans:
            native_plans.add(vehicle_id)
            try:
                plans[vehicle_id] = plan_from_record({"description": record["notes"]}) if record["state"] in {"new", "running"} else MaintenancePlan().model_dump(mode="json")
                if record["state"] in {"new", "running"}:
                    plans[vehicle_id]["next_date"] = record.get("date") or None
                invalid.discard(vehicle_id)
            except (ValueError, TypeError):
                plans[vehicle_id] = None
                invalid.add(vehicle_id)
    result = []
    for vehicle in vehicles:
        try:
            item = vehicle_attention(vehicle, documents[vehicle["id"]], plans.get(vehicle["id"]), contracts=contracts[vehicle["id"]], services=services[vehicle["id"]])
        except HTTPException as error:
            if error.status_code != 409:
                raise
            item = vehicle_attention(vehicle, [], plans.get(vehicle["id"]), contracts=contracts[vehicle["id"]], services=services[vehicle["id"]])
            item["alerts"].append({"kind": "documents", "reason": "review", "severity": "danger", "date": None})
        if vehicle["id"] in invalid:
            item["alerts"].append({"kind": "oil_change", "reason": "review", "severity": "danger", "date": None})
        if not enabled("automatic_reminders"):
            item["alerts"] = []
        result.append(item)
    return {"vehicles": result}


@router.put("/{vehicle_id}/maintenance-plan")
def save_plan(vehicle_id: int, data: MaintenancePlan):
    value = {"version": 1, **data.model_dump(mode="json")}
    return save_native_plan(vehicle_id, value)


@router.post("/{vehicle_id}/contracts/link")
def link_contracts(vehicle_id: int):
    return {"contract_ids": sync_saved_contracts(vehicle_id, KINDS)}


class ServiceCompletion(BaseModel):
    odometer: float = Field(ge=0, le=100000000, allow_inf_nan=False)
    completed_on: date = Field(default_factory=date.today)


@router.post("/{vehicle_id}/services/{service_id}/complete")
def complete_service(vehicle_id: int, service_id: int, data: ServiceCompletion):
    parent("fleet.vehicle", vehicle_id)
    rows = odoo.execute(SERVICE_MODEL, "search_read", [[
        ["id", "=", service_id], ["vehicle_id", "=", vehicle_id], ["active", "=", True],
    ]], {"fields": ["id", "state"]})
    if not rows:
        raise HTTPException(404, "Service not found for this vehicle.")
    if rows[0]["state"] == "done":
        return {"success": True}
    if rows[0]["state"] == "cancelled":
        raise HTTPException(409, "A cancelled service cannot be completed.")
    vehicles = odoo.execute("fleet.vehicle", "read", [[vehicle_id]], {"fields": ["odometer"]})
    if data.completed_on > date.today() or data.odometer < (vehicles[0].get("odometer") or 0):
        raise HTTPException(422, "Use today's or an earlier service date and the current or a higher odometer reading.")
    values = {"state": "done", "date": data.completed_on.isoformat()}
    if data.odometer:
        values["odometer"] = data.odometer
    if not odoo.execute(SERVICE_MODEL, "write", [[service_id], values]):
        raise HTTPException(502, "Service completion could not be saved.")
    return {"success": True}
