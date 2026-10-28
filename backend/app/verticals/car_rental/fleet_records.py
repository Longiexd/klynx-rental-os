"""Native Odoo Fleet records. Scans remain private vehicle attachments.

Only records explicitly marked as Klynx-managed may be updated automatically.
Reading the overview never migrates or writes customer data.
"""
from datetime import date
from fastapi import HTTPException
from app.odoo_client import odoo
from app.core.documents import document_checklist, expiry_reminder, parent
from app.core.record_metadata import read_metadata, write_metadata

CONTRACT_MODEL = "fleet.vehicle.log.contract"
SERVICE_MODEL = "fleet.vehicle.log.services"
CONTRACT_KEY = "fleet_contract"
PLAN_KEY = "fleet_care"
CONTRACT_KINDS = {"insurance": "Insurance", "lease": "Lease", "service_contract": "Service agreement"}


def fleet_records(vehicle_ids, include_services=True):
    domain = [["vehicle_id", "in", vehicle_ids], ["active", "=", True]]
    contracts = odoo.execute(CONTRACT_MODEL, "search_read", [domain], {
        "fields": ["id", "vehicle_id", "name", "expiration_date", "start_date", "state", "notes", "ins_ref"], "order": "id desc"})
    if not include_services:
        return contracts, []
    services = odoo.execute(SERVICE_MODEL, "search_read", [domain], {
        "fields": ["id", "vehicle_id", "service_type_id", "description", "date", "state", "notes"], "order": "id desc"})
    return contracts, services


def managed_contracts(vehicle_id):
    records = odoo.execute(CONTRACT_MODEL, "search_read", [[
        ["vehicle_id", "=", vehicle_id], ["active", "=", True],
        ["notes", "ilike", "[Klynx metadata:fleet_contract:"],
    ]], {"fields": ["id", "notes", "expiration_date", "start_date", "state"], "order": "id desc"})
    return records


def contract_kind(record):
    metadata = read_metadata(record.get("notes"), CONTRACT_KEY)
    return metadata["kind"] if metadata and metadata.get("version") == 1 and metadata.get("kind") in CONTRACT_KINDS else None


def contract_matches_document(record, document):
    metadata = read_metadata(record.get("notes"), CONTRACT_KEY) or {}
    return metadata.get("document_id") == document["id"] and metadata.get("expiry_date") == document["expiry_date"]


def document_needs_link(document, contracts):
    return bool(document["id"] and document["expiry_date"] and document["kind"] in CONTRACT_KINDS and not any(
        contract_kind(row) == document["kind"] and (row["state"] == "closed" or contract_matches_document(row, document)) for row in contracts))


def service_type(name, category):
    records = odoo.execute("fleet.service.type", "search_read", [[
        ["name", "=", name], ["category", "=", category],
    ]], {"fields": ["id"], "limit": 1})
    identifier = records[0]["id"] if records else odoo.execute("fleet.service.type", "create", [{"name": name, "category": category}])
    if not identifier:
        raise HTTPException(502, "Odoo Fleet service type could not be saved.")
    return identifier


def sync_contract(vehicle_id, attachment_id, document):
    kind = document["kind"]
    if kind not in CONTRACT_KINDS:
        return None
    parent("fleet.vehicle", vehicle_id)
    existing = [record for record in managed_contracts(vehicle_id) if contract_kind(record) == kind]
    if len(existing) > 1:
        raise HTTPException(409, "Multiple linked contracts exist. Review them in Odoo before retrying.")
    record = existing[0] if existing else None
    if not record and not document.get("expiry_date"):
        return None
    notes = write_metadata(record.get("notes") if record else "", CONTRACT_KEY,
                           {"version": 1, "kind": kind, "document_id": attachment_id, "expiry_date": document.get("expiry_date")})
    values = {"start_date": document.get("valid_from") or min(date.today().isoformat(), document.get("expiry_date") or date.today().isoformat()),
              "expiration_date": document.get("expiry_date") or False, "ins_ref": document.get("number", "")[:64], "notes": notes}
    if record:
        if record["state"] == "closed":
            raise HTTPException(409, "This linked contract was cancelled in Odoo. Review it before renewal.")
        if not odoo.execute(CONTRACT_MODEL, "write", [[record["id"]], values]):
            raise HTTPException(502, "Odoo Fleet contract could not be updated.")
        return record["id"]
    values.update(vehicle_id=vehicle_id, name=CONTRACT_KINDS[kind], cost_frequency="no",
                  cost_subtype_id=service_type(f"{CONTRACT_KINDS[kind]} (Klynx)", "contract"))
    identifier = odoo.execute(CONTRACT_MODEL, "create", [values])
    if not identifier:
        raise HTTPException(502, "Odoo Fleet contract could not be created.")
    return identifier


def contract_after_save(vehicle_id, attachment_id, document):
    # Upload acknowledgement must remain truthful if the following RPC fails.
    try:
        return {"contract_id": sync_contract(vehicle_id, attachment_id, document), "linked": True}
    except HTTPException:
        return {"linked": False, "message": "Scan saved; Fleet contract linking failed. Retry from Fleet care."}


def apply_contract_dates(checklist, contracts, today=None):
    today = today or date.today()
    for document in checklist["documents"]:
        record = next((row for row in contracts if contract_kind(row) == document["kind"]), None)
        if record and document["id"] and record["state"] == "closed":
            document["coverage_active"] = False
            document["verified"] = False
            document["status"] = "uploaded"
            continue
        if record and document["id"] and contract_matches_document(record, document):
            # A renewed Odoo contract does not automatically verify the previous scan.
            if document["expiry_date"] != (record["expiration_date"] or None):
                document["verified"] = False
            document["contract_id"] = record["id"]
            if document.get("valid_from") and document["valid_from"] != (record.get("start_date") or None):
                document["verified"] = False
            if record.get("start_date"):
                document["valid_from"] = record["start_date"]
            document["expiry_date"] = record["expiration_date"] or None
            document["reminder_date"] = expiry_reminder(date.fromisoformat(record["expiration_date"])) if record["expiration_date"] else None
            expired = bool(record["expiration_date"] and record["expiration_date"] < today.isoformat())
            document["status"] = "expired" if expired else "verified" if document["verified"] else "uploaded"
    checklist["ready"] = all(doc["status"] == "verified" or doc["optional"] and not doc["id"] for doc in checklist["documents"])
    return checklist


def enrich_checklist(vehicle_id, checklist):
    return apply_contract_dates(checklist, managed_contracts(vehicle_id))


def sync_saved_contracts(vehicle_id, kinds):
    checklist = document_checklist("fleet.vehicle", vehicle_id, kinds)
    linked = managed_contracts(vehicle_id)
    return [sync_contract(vehicle_id, doc["id"], doc) for doc in checklist["documents"]
            if document_needs_link(doc, linked)]


def save_native_plan(vehicle_id, value):
    parent("fleet.vehicle", vehicle_id)
    records = odoo.execute(SERVICE_MODEL, "search_read", [[
        ["vehicle_id", "=", vehicle_id], ["active", "=", True],
        ["notes", "ilike", "[Klynx metadata:fleet_care:"],
    ]], {"fields": ["id", "notes", "state"], "order": "id desc"})
    pending = [row for row in records if row["state"] in {"new", "running"} and read_metadata(row.get("notes"), PLAN_KEY)]
    if len(pending) > 1:
        raise HTTPException(409, "Multiple oil-change plans exist. Review them in Odoo before retrying.")
    previous = pending[0] if pending else None
    enabled = value["next_odometer"] is not None or value["next_date"] is not None
    # A cancelled marker supersedes the old attachment plan, even if this is the first native save.
    values = {"notes": write_metadata(previous.get("notes") if previous else "", PLAN_KEY, value),
              "date": value["next_date"] or False, "state": previous["state"] if previous and enabled else "new" if enabled else "cancelled"}
    if previous:
        if not odoo.execute(SERVICE_MODEL, "write", [[previous["id"]], values]):
            raise HTTPException(502, "Odoo oil-change plan could not be updated.")
        return {**value, "service_id": previous["id"]}
    values.update(vehicle_id=vehicle_id, description="Vidange / Oil change",
                  service_type_id=service_type("Vidange / Oil change (Klynx)", "service"))
    # Never write a future target into Odoo's actual odometer field.
    identifier = odoo.execute(SERVICE_MODEL, "create", [values])
    if not identifier:
        raise HTTPException(502, "Odoo oil-change plan could not be created.")
    return {**value, "service_id": identifier}
