"""Rental eligibility from verified Odoo vehicle evidence, independent of reminders."""
from datetime import date
from collections import defaultdict

from fastapi import HTTPException
from app.odoo_client import odoo
from app.core.documents import checklist_from_records, parent
from app.verticals.car_rental.fleet_records import fleet_records, apply_contract_dates

KINDS = {"insurance": "Insurance", "registration": "Registration",
         "technical_inspection": "Technical inspection", "vignette": "Circulation tax",
         "operating_permit": "Operating card", "lease": "Lease contract", "service_contract": "Service contract"}
REQUIRED = {"insurance", "registration", "technical_inspection", "vignette", "operating_permit"}
PAYMENT_REQUIRED = {"insurance", "vignette"}


def evaluate(documents, today=None, through=None):
    """Expiry is inclusive. Eligibility must cover the entire proposed rental."""
    today = today or date.today()
    through = max(today, through or today).isoformat()
    today = today.isoformat()
    by_kind = {doc["kind"]: doc for doc in documents}
    reasons = []
    for kind in sorted(REQUIRED):
        doc = by_kind.get(kind) or {}
        reason = None
        if not doc.get("id"):
            reason = "missing"
        elif doc.get("coverage_active") is False:
            reason = "coverage_inactive"
        elif not doc.get("verified"):
            reason = "uploaded"
        elif doc.get("valid_from") and doc["valid_from"] > today:
            reason = "not_started"
        elif kind in {"insurance", "technical_inspection", "vignette"} and not doc.get("expiry_date"):
            reason = "date_missing"
        elif doc.get("expiry_date") and doc["expiry_date"] < through:
            reason = "expired" if doc["expiry_date"] < today else "expires_during_rental"
        elif kind in PAYMENT_REQUIRED and not doc.get("payment_confirmed"):
            reason = "payment_unconfirmed"
        if reason:
            reasons.append({"kind": kind, "reason": reason, "severity": "danger", "date": doc.get("expiry_date")})
    return {"eligible": not reasons, "blocking_reasons": reasons}


def fleet_eligibility(vehicle_ids, through=None):
    from app.features import enabled
    if not enabled("fleet_compliance"):
        return {identifier: {"eligible": True, "blocking_reasons": []} for identifier in vehicle_ids}
    if not vehicle_ids:
        return {}
    records = odoo.execute("ir.attachment", "search_read", [[
        ["res_model", "=", "fleet.vehicle"], ["res_id", "in", vehicle_ids],
        ["public", "=", False], ["type", "=", "binary"],
        ["description", "ilike", "[Klynx metadata:document:"],
    ]], {"fields": ["id", "res_id", "name", "description", "checksum"], "order": "id desc"})
    contracts, _ = fleet_records(vehicle_ids, include_services=False)
    grouped, linked = defaultdict(list), defaultdict(list)
    for row in records:
        grouped[row["res_id"]].append(row)
    for row in contracts:
        linked[row["vehicle_id"][0]].append(row)
    result = {}
    for vehicle_id in vehicle_ids:
        try:
            checklist = checklist_from_records(grouped[vehicle_id], KINDS)
            apply_contract_dates(checklist, linked[vehicle_id], date.today())
            result[vehicle_id] = evaluate(checklist["documents"], through=through)
        except HTTPException as error:
            if error.status_code != 409:
                raise
            result[vehicle_id] = {"eligible": False, "blocking_reasons": [
                {"kind": "documents", "reason": "review", "severity": "danger", "date": None}]}
    return result


def vehicle_eligibility(vehicle_id, through=None):
    parent("fleet.vehicle", vehicle_id)
    return fleet_eligibility([vehicle_id], through)[vehicle_id]


def ensure_eligible(vehicle_id, through=None):
    result = vehicle_eligibility(vehicle_id, through)
    if not result["eligible"]:
        details = "; ".join(f"{KINDS.get(item['kind'], item['kind'])}: {item['reason']}" for item in result["blocking_reasons"])
        raise HTTPException(409, f"Vehicle unavailable for rental. {details}. Review Fleet care before confirmation or pickup.")
    return result
