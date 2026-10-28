"""Private document tracking on native Odoo attachments, scoped to their parent."""
import base64
import binascii
from calendar import monthrange
from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.core.record_metadata import read_metadata, write_metadata
from app.odoo_client import odoo

MAX_FILE_BYTES = 600 * 1024  # Base64 plus metadata stays below the existing 1 MiB proxy limit.
KEY = "document"
CUSTOMER_KINDS = {"cin": "CIN", "passport": "Passport", "driving_license": "Driving licence"}


def expiry_reminder(expiry):
    if not expiry:
        return None
    if expiry.year == 1 and expiry.month == 1:
        return date.min.isoformat()
    month = expiry.month - 1 or 12
    year = expiry.year - (expiry.month == 1)
    return date(year, month, min(expiry.day, monthrange(year, month)[1])).isoformat()


class IdentityFields(BaseModel):
    birth_date: date | None = None

    @field_validator("birth_date")
    @classmethod
    def past_birth_date(cls, value):
        if value and value > date.today():
            raise ValueError("Date of birth cannot be in the future.")
        return value


class FleetEvidenceFields(IdentityFields):
    valid_from: date | None = None
    payment_confirmed: bool = False


class DocumentUpload(FleetEvidenceFields):
    kind: str = Field(min_length=1, max_length=40)
    content: str = Field(min_length=1, max_length=819200)
    filename: str = Field(min_length=1, max_length=200)
    number: str = Field(default="", max_length=100)
    expiry_date: date | None = None
    nationality: str = Field(default="", max_length=100)


class DocumentUpdate(FleetEvidenceFields):
    number: str = Field(default="", max_length=100)
    expiry_date: date | None = None
    verified: bool = False
    nationality: str | None = Field(default=None, max_length=100)


def file_type(content: bytes):
    if content.startswith(b"%PDF-"):
        return "application/pdf", "pdf"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    raise HTTPException(415, "Choose a PDF, PNG or JPEG document.")


def parent(model, record_id):
    records = odoo.execute(model, "search_read", [[["id", "=", record_id]]],
                           {"fields": ["id"], "limit": 1})
    if not records:
        raise HTTPException(404, "Document owner not found.")


def metadata(attachment):
    value = read_metadata(attachment.get("description"), KEY)
    if not value or value.get("version") != 1:
        return None
    if (not isinstance(value.get("kind"), str) or not isinstance(value.get("number"), str)
            or len(value["number"]) > 100 or not isinstance(value.get("verified"), bool)
            or not isinstance(value.get("nationality", ""), str) or len(value.get("nationality", "")) > 100):
        return None
    try:
        if value.get("expiry_date"):
            date.fromisoformat(value["expiry_date"])
        if value.get("valid_from"):
            date.fromisoformat(value["valid_from"])
        if not isinstance(value.get("payment_confirmed", False), bool):
            return None
        if value.get("birth_date") and date.fromisoformat(value["birth_date"]) > date.today():
            return None
    except (ValueError, TypeError):
        return None
    return value


def tracked_attachment(model, record_id, attachment_id, kinds, scope=None):
    parent(model, record_id)
    records = odoo.execute("ir.attachment", "search_read", [[
        ["id", "=", attachment_id], ["res_model", "=", model], ["res_id", "=", record_id],
        ["type", "=", "binary"], ["public", "=", False],
    ]], {"fields": ["id", "name", "description"], "limit": 1})
    if not records or not (value := metadata(records[0])) or value.get("kind") not in kinds or value.get("scope") != scope:
        raise HTTPException(404, "Tracked document not found for this record.")
    return records[0], value


def checklist_from_records(records, kinds, scope=None):
    latest = {}
    for attachment in records:
        value = metadata(attachment)
        if value is None:
            raise HTTPException(409, "A tracked document has invalid metadata. Review its attachment in Odoo.")
        if value.get("scope") == scope and value.get("kind") in kinds:
            latest.setdefault(value["kind"], (attachment, value))
    documents = []
    for kind, label in kinds.items():
        item = {"kind": kind, "label": label, "status": "missing", "id": None,
                "filename": None, "number": "", "expiry_date": None, "verified": False, "checksum": None,
                "nationality": "", "birth_date": None, "reminder_date": None,
                "optional": kind in {"lease", "service_contract"}, "valid_from": None, "payment_confirmed": False}
        if kind in latest:
            attachment, value = latest[kind]
            expired = bool(value.get("expiry_date") and value["expiry_date"] < date.today().isoformat())
            item.update(id=attachment["id"], filename=attachment["name"], number=value["number"], checksum=attachment.get("checksum"),
                        expiry_date=value.get("expiry_date"), verified=value["verified"],
                        nationality=value.get("nationality", ""), birth_date=value.get("birth_date"),
                        valid_from=value.get("valid_from"), payment_confirmed=value.get("payment_confirmed", False),
                        reminder_date=expiry_reminder(date.fromisoformat(value["expiry_date"])) if value.get("expiry_date") else None,
                        status="expired" if expired else "verified" if value["verified"] else "uploaded")
        documents.append(item)
    valid = {item["kind"] for item in documents if item["status"] == "verified" and item["number"].strip()}
    ready = bool(valid & {"cin", "passport"}) and "driving_license" in valid if "cin" in kinds else all(item["status"] == "verified" or item["optional"] and not item["id"] for item in documents)
    return {"documents": documents, "ready": ready}


def document_checklist(model, record_id, kinds, scope=None):
    parent(model, record_id)
    records = odoo.execute("ir.attachment", "search_read", [[
        ["res_model", "=", model], ["res_id", "=", record_id], ["type", "=", "binary"],
        ["public", "=", False], ["description", "ilike", "[Klynx metadata:document:"],
    ]], {"fields": ["id", "name", "description", "checksum"], "order": "id desc"})
    return checklist_from_records(records, kinds, scope)


def attachment_content(attachment_id, limit=MAX_FILE_BYTES):
    # Odoo can return a human-readable size in datas; explicitly request the bytes.
    rows = odoo.execute("ir.attachment", "read", [[attachment_id]],
                        {"fields": ["datas", "db_datas"], "context": {"bin_size": False}})
    for field in ("datas", "db_datas"):
        try:
            content = base64.b64decode(rows[0].get(field) or "", validate=True)
        except (ValueError, TypeError, IndexError, binascii.Error):
            continue
        if content and len(content) <= limit:
            return content
    raise HTTPException(409, "The scan cannot be read from Odoo storage. Upload it again; if this repeats, check the Odoo filestore.")


def save_attachment(values, limit=MAX_FILE_BYTES):
    """Only acknowledge an upload after it can be read back through the same user session."""
    attachment_id = odoo.execute("ir.attachment", "create", [values], {"context": {"image_no_postprocess": True}})
    if not attachment_id:
        raise HTTPException(502, "The document could not be saved.")
    expected = base64.b64decode(values["datas"])
    try:
        stored = attachment_content(attachment_id, limit)
    except HTTPException as error:
        if error.status_code != 409:
            raise
        # Odoo may acknowledge creation even when its filestore write failed.
        # Keep a bounded private database copy in that case, without changing global storage.
        if not odoo.execute("ir.attachment", "write", [[attachment_id], {"db_datas": values["datas"]}]):
            raise HTTPException(502, "The scan could not be persisted. Check Odoo storage before retrying.")
        stored = attachment_content(attachment_id, limit)
    if stored != expected:
        raise HTTPException(409, "The saved scan differs from the uploaded file. Review Odoo storage before retrying.")
    return attachment_id


def document_router(model: Literal["res.partner", "fleet.vehicle", "sale.order"], kinds: dict[str, str], scope=None, edit_guard=None, after_save=None, enrich=None):
    """Reuse the same workflow under customers and the fleet without exposing arbitrary models."""
    router = APIRouter(prefix="/{record_id}/documents", tags=["Documents"])

    @router.get("")
    def checklist(record_id: int):
        result = document_checklist(model, record_id, kinds, scope)
        return enrich(record_id, result) if enrich else result

    @router.post("")
    def upload(record_id: int, data: DocumentUpload):
        owner_key = edit_guard(record_id) if edit_guard else None
        parent(model, record_id)
        if data.kind not in kinds:
            raise HTTPException(422, "Choose an available document type.")
        try:
            content = base64.b64decode(data.content, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(422, "Invalid document content.") from None
        if not content or len(content) > MAX_FILE_BYTES:
            raise HTTPException(413, "Document must be at most 600 KiB. Compress the scan before uploading.")
        mime, extension = file_type(content)
        value = {"version": 1, "kind": data.kind, "number": data.number.strip(),
                 "expiry_date": data.expiry_date.isoformat() if data.expiry_date else None, "verified": False}
        if scope:
            value["scope"] = scope
        if owner_key:
            value["owner_key"] = owner_key
        if (model == "res.partner" or scope == "additional_driver") and data.kind in ("cin", "passport"):
            value.update(nationality=data.nationality.strip(), birth_date=data.birth_date.isoformat() if data.birth_date else None)
        if model == "fleet.vehicle":
            if data.valid_from and data.expiry_date and data.valid_from > data.expiry_date:
                raise HTTPException(422, "Coverage start must be before its expiry date.")
            value.update(valid_from=data.valid_from.isoformat() if data.valid_from else None,
                         payment_confirmed=data.payment_confirmed, reminder_date=expiry_reminder(data.expiry_date))
        attachment_id = save_attachment({
            "name": f"{data.kind}.{extension}", "type": "binary", "datas": data.content,
            "mimetype": mime, "res_model": model, "res_id": record_id, "public": False,
            "description": write_metadata("", KEY, value),
        })
        result = {"success": True, "attachment_id": attachment_id}
        if after_save:
            result["fleet_sync"] = after_save(record_id, attachment_id, value)
        return result

    @router.patch("/{attachment_id}")
    def update(record_id: int, attachment_id: int, data: DocumentUpdate):
        owner_key = edit_guard(record_id) if edit_guard else None
        attachment, value = tracked_attachment(model, record_id, attachment_id, kinds, scope)
        if owner_key and value.get("owner_key") != owner_key:
            raise HTTPException(409, "This scan belongs to the previous additional driver. Upload the current driver's document.")
        value.update(number=data.number.strip(), verified=data.verified,
                     expiry_date=data.expiry_date.isoformat() if data.expiry_date else None)
        if model == "fleet.vehicle":
            if data.valid_from and data.expiry_date and data.valid_from > data.expiry_date:
                raise HTTPException(422, "Coverage start must be before its expiry date.")
            if "valid_from" in data.model_fields_set:
                value["valid_from"] = data.valid_from.isoformat() if data.valid_from else None
            if "payment_confirmed" in data.model_fields_set:
                value["payment_confirmed"] = data.payment_confirmed
            if value.get("valid_from") and data.expiry_date and value["valid_from"] > data.expiry_date.isoformat():
                raise HTTPException(422, "Coverage start must be before its expiry date.")
            value["reminder_date"] = expiry_reminder(data.expiry_date)
        # Older callers omit these optional fields; preserve their saved contact data.
        if (model == "res.partner" or scope == "additional_driver") and value["kind"] in ("cin", "passport"):
            if "nationality" in data.model_fields_set:
                value["nationality"] = (data.nationality or "").strip()
            if "birth_date" in data.model_fields_set:
                value["birth_date"] = data.birth_date.isoformat() if data.birth_date else None
        if data.verified and data.expiry_date and data.expiry_date < date.today():
            raise HTTPException(422, "An expired document cannot be marked verified.")
        if data.verified:
            if (model == "res.partner" or scope == "additional_driver") and not value["number"]:
                raise HTTPException(422, "Enter the document number before verifying identity or licence.")
            file_type(attachment_content(attachment_id))
        if not odoo.execute("ir.attachment", "write", [[attachment_id],
                            {"description": write_metadata(attachment["description"], KEY, value)}]):
            raise HTTPException(502, "Document changes could not be saved.")
        result = {"success": True}
        if after_save:
            result["fleet_sync"] = after_save(record_id, attachment_id, value)
        return result

    @router.get("/{attachment_id}/download")
    def download(record_id: int, attachment_id: int):
        tracked_attachment(model, record_id, attachment_id, kinds, scope)
        content = attachment_content(attachment_id)
        mime, extension = file_type(content)
        return {"content": base64.b64encode(content).decode(), "mime": mime,
                "filename": f"document-{attachment_id}.{extension}"}

    return router
