"""Company templates and immutable rental paperwork on private native attachments."""
import base64
import hashlib
import json
from datetime import datetime, timezone
from html import escape
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from app.core.bookings import booking_status
from app.core.documents import (CUSTOMER_KINDS, attachment_content, document_checklist,
                                file_type, save_attachment, checklist_from_records, IdentityFields)
from app.core.record_metadata import read_metadata, write_metadata
from app.odoo_client import odoo

FIELDS = {
    "agency": "Agence / الشركة", "booking": "Réservation / الحجز", "agency_phone": "Téléphone agence",
    "customer": "Nom et prénom / الاسم واللقب", "phone": "GSM", "address": "Adresse / العنوان",
    "birth_date": "Date de naissance", "nationality": "Nationalité", "identity_type": "CIN / Passeport",
    "identity_number": "Pièce d’identité / الهوية", "license": "Permis N° / رخصة السياقة", "license_issued": "Permis délivré le",
    "driver": "Conducteur supplémentaire", "driver_identity": "Identité du conducteur", "driver_license": "Permis du conducteur",
    "driver_identity_type": "CIN / Passeport conducteur", "driver_birth_date": "Naissance conducteur", "driver_nationality": "Nationalité conducteur",
    "driver_phone": "GSM conducteur", "driver_address": "Adresse conducteur", "driver_license_issued": "Permis conducteur délivré le",
    "vehicle": "Véhicule / السيارة", "plate": "Immatriculation / الرقم المنجمي",
    "pickup": "Départ : date et heure / الاستلام", "return": "Retour : date et heure / الإرجاع",
    "pickup_location": "Lieu de départ", "return_location": "Lieu de retour",
    "total": "Prix total TTC", "paid": "Acompte / montant payé", "balance": "Reste à payer", "currency": "Devise",
    "deposit": "Caution", "pickup_km": "Km départ", "return_km": "Km retour", "fuel": "Carburant", "notes": "Observations",
}
EXTRA_KEYS = {"birth_date", "nationality", "license_issued", "driver", "driver_identity", "driver_license", "deposit", "fuel", "notes"}
ORDER_FIELDS = ["id", "name", "state", "note", "partner_id", "company_id", "currency_id", "date_order", "commitment_date", "amount_total", "invoice_ids"]
CONTRACT_LIMIT = 2 * 1024 * 1024


class AdditionalDriver(IdentityFields):
    active: bool = True
    name: str = Field(default="", max_length=250)
    phone: str = Field(default="", max_length=100)
    address: str = Field(default="", max_length=250)
    nationality: str = Field(default="", max_length=100)
    license_issued: str = Field(default="", max_length=100)
    fee_reviewed: bool = False

    @model_validator(mode="after")
    def named_driver(self):
        self.name = self.name.strip()
        if self.active and not self.name:
            raise ValueError("Enter the additional driver's name.")
        return self


def driver_state(order, records=None):
    if records is None:
        records = odoo.execute("ir.attachment", "search_read", [[["res_model", "=", "sale.order"], ["res_id", "=", order["id"]],
            ["type", "=", "binary"], ["public", "=", False]]], {"fields": ["id", "name", "description", "checksum"], "order": "id desc"})
    profile = next((read_metadata(row.get("description"), "additional_driver") for row in records
                    if read_metadata(row.get("description"), "additional_driver") is not None), None)
    if profile is not None:
        profile = AdditionalDriver.model_validate(profile).model_dump(mode="json")
    owner_key = digest(profile["name"].casefold()) if profile else None
    scans = [row for row in records if (value := read_metadata(row.get("description"), "document"))
             and (value.get("scope") != "additional_driver" or value.get("owner_key") == owner_key)]
    checklist = checklist_from_records(scans, CUSTOMER_KINDS, "additional_driver")
    active = bool(profile and profile["active"])
    # Fee acknowledgement has no effect on the identity printed in a contract.
    identity = {key: value for key, value in (profile or {}).items() if key not in ("fee_reviewed", "active")}
    return {"profile": profile, **checklist, "ready": not active or checklist["ready"],
            "digest": digest([identity, document_digest(checklist)]) if active else None}


def editable_driver(order_id):
    from app.verticals.car_rental.states import PICKED_UP_TAG, RETURNED_TAG
    order = order_record(order_id)
    if booking_status(order) == "cancelled" or any(tag in (order.get("note") or "") for tag in (PICKED_UP_TAG, RETURNED_TAG)):
        raise HTTPException(409, "Additional-driver paperwork can be edited before vehicle handover.")
    return order


def driver_document_guard(order_id):
    state = driver_state(editable_driver(order_id))
    if not state["profile"] or not state["profile"]["active"]:
        raise HTTPException(409, "Save the additional driver's name before uploading documents.")
    return digest(state["profile"]["name"].casefold())


def save_driver(order_id, data):
    order = editable_driver(order_id)
    value = data.model_dump(mode="json")
    previous = driver_state(order)["profile"]
    if not previous or not previous["active"] or previous["name"].casefold() != value["name"].casefold():
        value["fee_reviewed"] = False
    content = b"Private additional-driver paperwork"
    save_attachment({"name": "Additional driver", "type": "binary", "datas": base64.b64encode(content).decode(),
        "mimetype": "text/plain", "res_model": "sale.order", "res_id": order_id, "public": False,
        "description": write_metadata("", "additional_driver", value)})
    return {"success": True}


def driver_fee_status(order):
    lines = odoo.execute("sale.order.line", "search_read", [[["order_id", "=", order["id"]], ["product_uom_qty", ">", 0],
        ["product_id.default_code", "=ilike", "OPT-CDSUPP%"]]], {"fields": ["product_uom_qty", "qty_invoiced", "price_unit"]})
    if not lines:
        return "check_fee"
    return "invoice_pending" if any(row.get("price_unit", 0) > 0 and row.get("qty_invoiced", 0) < row["product_uom_qty"] for row in lines) else "included"


class ContractPrepare(BaseModel):
    details: dict[str, str] = Field(default_factory=dict, max_length=9)

    @model_validator(mode="after")
    def bounded_details(self):
        if any(key not in EXTRA_KEYS or len(value) > (2000 if key == "notes" else 250) for key, value in self.details.items()):
            raise ValueError("Choose known contract fields and bounded plain text.")
        return self


class ContractPrinted(BaseModel):
    contract_id: int = Field(gt=0)


class Position(BaseModel):
    x: float = Field(ge=0, le=95, allow_inf_nan=False)
    y: float = Field(ge=0, le=97, allow_inf_nan=False)
    width: float = Field(default=25, ge=3, le=100, allow_inf_nan=False)
    size: int = Field(default=10, ge=6, le=20)

    @model_validator(mode="after")
    def inside_page(self):
        if self.x + self.width > 100:
            raise ValueError("Field must fit inside the page.")
        return self


class TemplateSetup(BaseModel):
    mode: Literal["basic", "image"] = "basic"
    background: str | None = Field(default=None, max_length=819200)
    positions: dict[str, Position] = Field(default_factory=dict, max_length=len(FIELDS))
    terms: str = Field(default="", max_length=12000)

    @model_validator(mode="after")
    def known_fields(self):
        if any(key not in FIELDS for key in self.positions):
            raise ValueError("Unknown contract field.")
        return self


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def order_record(order_id):
    rows = odoo.execute("sale.order", "search_read", [[["id", "=", order_id]]], {"fields": ORDER_FIELDS, "limit": 1})
    if not rows:
        raise HTTPException(404, "Rental not found.")
    return rows[0]


def selected_documents(checklist):
    valid = {item["kind"]: item for item in checklist["documents"] if item["status"] == "verified" and item["number"].strip()}
    identity = valid.get("cin") or valid.get("passport")
    return [identity, valid["driving_license"]] if identity and "driving_license" in valid else []


def customer_details(checklist):
    identities = [item for item in checklist["documents"] if item["kind"] in ("cin", "passport")]
    identity = next((item for item in identities if item["status"] == "verified" and item["number"].strip()), None)
    identity = identity or next((item for item in identities if item.get("id")), {})
    return {key: identity[key] for key in ("nationality", "birth_date") if identity.get(key)}


def booking_digest(order):
    from app.routes.calendar import rental_vehicle_id
    values = {key: order.get(key) for key in ("partner_id", "company_id", "currency_id", "date_order", "commitment_date", "amount_total")}
    values.update(vehicle=rental_vehicle_id(order.get("note")), logistics=read_metadata(order.get("note"), "rental_logistics"))
    return digest(values)


def document_digest(checklist):
    return digest([{**{key: item.get(key) for key in ("id", "kind", "number", "expiry_date", "checksum")},
                    **{key: item[key] for key in ("nationality", "birth_date") if item.get(key)}} for item in selected_documents(checklist)])


def record_summary(order, checklist, driver=None):
    record = read_metadata(order.get("note"), "rental_contract") or {}
    driver = driver or {"ready": True, "digest": None}
    ready = checklist["ready"] and driver["ready"]
    current = bool(ready and record.get("version") == 1 and record.get("contract_id")
                   and record.get("driver_digest") == driver["digest"]
                   and record.get("booking_digest") == booking_digest(order) and record.get("document_digest") == document_digest(checklist))
    return {"documents_ready": ready, "documents": checklist["documents"],
            "contract_current": current, "contract_ready": current and bool(record.get("printed_at")),
            "contract_id": record.get("contract_id"), "printed_at": record.get("printed_at") if current else None,
            "snapshot_ids": record.get("snapshot_ids") or []}


def paperwork(order_id):
    order = order_record(order_id)
    if not order.get("partner_id"):
        raise HTTPException(409, "Choose a customer first.")
    checklist = document_checklist("res.partner", order["partner_id"][0], CUSTOMER_KINDS)
    driver = driver_state(order)
    status = {**record_summary(order, checklist, driver), "additional_driver": driver}
    from app.verticals.car_rental.states import PICKED_UP_TAG, RETURNED_TAG
    if status["contract_current"] and not any(tag in (order.get("note") or "") for tag in (PICKED_UP_TAG, RETURNED_TAG)):
        details = read_metadata(order.get("note"), "rental_paperwork") or {}
        record = read_metadata(order.get("note"), "rental_contract") or {}
        if record.get("values_digest") != digest(contract_values(order, checklist, details, driver)):
            status.update(contract_current=False, contract_ready=False, printed_at=None)
    return order, checklist, status


def batch_paperwork(orders):
    partners = {row["partner_id"][0] for row in orders if row.get("partner_id")}
    rows = odoo.execute("ir.attachment", "search_read", [[["res_model", "=", "res.partner"], ["res_id", "in", sorted(partners)],
        ["type", "=", "binary"], ["public", "=", False], ["description", "ilike", "[Klynx metadata:document:"]]],
        {"fields": ["id", "res_id", "name", "description", "checksum"], "order": "id desc"}) if partners else []
    grouped = {partner: [] for partner in partners}
    for row in rows:
        if row["res_id"] in grouped:
            grouped[row["res_id"]].append(row)
    checklists = {partner: checklist_from_records(items, CUSTOMER_KINDS) for partner, items in grouped.items()}
    driver_rows = odoo.execute("ir.attachment", "search_read", [[["res_model", "=", "sale.order"], ["res_id", "in", [row["id"] for row in orders]],
        ["type", "=", "binary"], ["public", "=", False]]], {"fields": ["id", "res_id", "name", "description", "checksum"], "order": "id desc"}) if orders else []
    by_order = {}
    for attachment in driver_rows:
        by_order.setdefault(attachment["res_id"], []).append(attachment)
    return {row["id"]: record_summary(row, checklists.get(row["partner_id"][0], {"documents": [], "ready": False}), driver_state(row, by_order.get(row["id"], [])))
            for row in orders if row.get("partner_id")}


def stored_contract(order, check_documents=False):
    record = read_metadata(order.get("note"), "rental_contract") or {}
    rows = odoo.execute("ir.attachment", "search_read", [[["id", "=", record.get("contract_id") or 0],
        ["res_model", "=", "sale.order"], ["res_id", "=", order["id"]], ["type", "=", "binary"], ["public", "=", False]]],
        {"fields": ["id", "description"], "limit": 1})
    if not rows or read_metadata(rows[0].get("description"), "rental_contract_file") != {"sha256": record.get("html_sha256")}:
        raise HTTPException(409, "Saved contract is unavailable. Prepare it again before pickup.")
    content = attachment_content(rows[0]["id"], CONTRACT_LIMIT)
    if hashlib.sha256(content).hexdigest() != record.get("html_sha256"):
        raise HTTPException(409, "Saved contract has changed. Prepare it again.")
    if check_documents:
        ids = record.get("snapshot_ids") or []
        copies = odoo.execute("ir.attachment", "search_read", [[["id", "in", ids], ["res_model", "=", "sale.order"],
            ["res_id", "=", order["id"]], ["type", "=", "binary"], ["public", "=", False]]], {"fields": ["id", "description"]})
        if len(ids) != (4 if record.get("driver_digest") else 2) or {row["id"] for row in copies} != set(ids):
            raise HTTPException(409, "Rental document copies are unavailable. Prepare the contract again.")
        for copy in copies:
            value = read_metadata(copy.get("description"), "document") or {}
            if (value.get("fingerprint") != record.get("fingerprint")
                    or hashlib.sha256(attachment_content(copy["id"])).hexdigest() != value.get("sha256")):
                raise HTTPException(409, "Rental document copies have changed. Prepare the contract again.")
    return content.decode("utf-8")


def ensure_pickup_paperwork(order_id):
    order, _, status = paperwork(order_id)
    if not status["documents_ready"]:
        raise HTTPException(409, "Before handing over the keys, verify identity and driving licence for the client and any additional driver.")
    if not status["contract_ready"]:
        raise HTTPException(409, "Prepare the rental contract, print or save it, then confirm it is ready before pickup.")
    stored_contract(order, check_documents=True)
    return order


def company_record(order):
    rows = odoo.execute("res.company", "read", [[order["company_id"][0]]], {"fields": ["id", "name", "phone", "partner_id"]}) if order.get("company_id") else []
    if not rows or not rows[0].get("partner_id"):
        raise HTTPException(409, "The rental company contact is unavailable.")
    return rows[0]


def company_template(order, with_background=False):
    company = company_record(order)
    rows = odoo.execute("ir.attachment", "search_read", [[["res_model", "=", "res.partner"], ["res_id", "=", company["partner_id"][0]],
        ["company_id", "=", company["id"]], ["type", "=", "binary"], ["public", "=", False],
        ["description", "ilike", "[Klynx metadata:contract_template:"]]], {"fields": ["id", "description"], "order": "id desc", "limit": 1})
    result = {"id": None, "mode": "basic", "positions": {}, "terms": "", "background": None}
    if rows:
        value = read_metadata(rows[0]["description"], "contract_template")
        if not value or value.get("company_id") != company["id"]:
            raise HTTPException(409, "Company template metadata is invalid.")
        setup = TemplateSetup.model_validate(value)
        result.update(setup.model_dump(exclude={"background"}), id=rows[0]["id"])
        if with_background and setup.mode == "image":
            content = attachment_content(rows[0]["id"])
            mime, _ = file_type(content)
            if mime not in ("image/png", "image/jpeg"):
                raise HTTPException(409, "Template background must be a PNG or JPEG.")
            result.update(background=base64.b64encode(content).decode(), mime=mime)
    return result


def save_template(order_id, data):
    order = order_record(order_id)
    company = company_record(order)
    if data.mode == "image":
        encoded = data.background or company_template(order, True).get("background")
        try:
            content = base64.b64decode(encoded or "", validate=True)
        except ValueError:
            raise HTTPException(422, "Invalid template image.") from None
        if not content or len(content) > 600 * 1024:
            raise HTTPException(413, "Choose an A4 portrait PNG or JPEG up to 600 KiB.")
        mime, _ = file_type(content)
        if mime not in ("image/png", "image/jpeg") or not data.positions:
            raise HTTPException(422, "Choose a PNG/JPEG background and place the fields on it.")
    else:
        content, mime = b"Klynx basic bilingual rental contract", "text/plain"
    value = data.model_dump(exclude={"background"}) | {"company_id": company["id"]}
    attachment_id = save_attachment({"name": "Rental contract template", "type": "binary", "datas": base64.b64encode(content).decode(),
        "mimetype": mime, "res_model": "res.partner", "res_id": company["partner_id"][0], "company_id": company["id"], "public": False,
        "description": write_metadata("", "contract_template", value)})
    return {"success": True, "template_id": attachment_id}


def contract_values(order, checklist, details, driver=None):
    from app.routes.calendar import rental_vehicle_id
    clients = odoo.execute("res.partner", "read", [[order["partner_id"][0]]], {"fields": ["name", "phone", "street", "city"]})
    if not clients:
        raise HTTPException(404, "The rental customer is unavailable.")
    client = clients[0]
    vehicle_id = rental_vehicle_id(order.get("note"))
    if not vehicle_id:
        raise HTTPException(409, "Choose a vehicle before preparing the contract.")
    vehicles = odoo.execute("fleet.vehicle", "read", [[vehicle_id]], {"fields": ["name", "license_plate", "odometer", "odometer_unit"]})
    if not vehicles:
        raise HTTPException(404, "The rental vehicle is unavailable.")
    vehicle = vehicles[0]
    company = company_record(order)
    invoices = odoo.execute("account.move", "search_read", [[["id", "in", order.get("invoice_ids") or []], ["state", "=", "posted"],
        ["move_type", "in", ["out_invoice", "out_refund"]]]], {"fields": ["amount_total", "amount_residual", "move_type"]}) if order.get("invoice_ids") else []
    paid = sum((item["amount_total"] - item["amount_residual"]) * (-1 if item["move_type"] == "out_refund" else 1) for item in invoices)
    identity, licence = selected_documents(checklist)
    logistics = read_metadata(order.get("note"), "rental_logistics") or {}
    pickup = read_metadata(order.get("note"), "rental_pickup") or {}
    driver_values = {}
    if driver and (driver.get("profile") or {}).get("active"):
        profile = driver["profile"]
        driver_identity, driver_licence = selected_documents(driver)
        driver_values = {"driver": profile["name"], "driver_identity": driver_identity["number"], "driver_identity_type": driver_identity["label"],
            "driver_license": driver_licence["number"], **{f"driver_{key}": profile.get(key) for key in ("phone", "address", "birth_date", "nationality", "license_issued")},
            **{f"driver_{key}": value for key, value in customer_details(driver).items()}}
    return {"agency": company["name"], "agency_phone": company.get("phone"), "booking": order["name"], "customer": client["name"],
        "phone": client.get("phone"), "address": " ".join(str(client.get(key) or "") for key in ("street", "city")),
        "identity_type": identity["label"], "identity_number": identity["number"], "license": licence["number"],
        "vehicle": vehicle["name"], "plate": vehicle.get("license_plate"), "pickup": order.get("date_order"), "return": order.get("commitment_date"),
        "pickup_location": logistics.get("pickup_location"), "return_location": logistics.get("return_location"),
        "total": order["amount_total"], "paid": paid, "balance": max(0, order["amount_total"] - paid),
        "currency": order["currency_id"][1] if order.get("currency_id") else "", "pickup_km": pickup.get("odometer", vehicle.get("odometer")),
        **customer_details(checklist), **details, **driver_values}


def render_contract(values, template=None):
    template = template or {"mode": "basic", "terms": ""}
    cell = lambda value: escape(str(value)) if value is not None and value is not False and value != "" else "—"
    if template["mode"] == "image":
        body = f'<img class="background" src="data:{template["mime"]};base64,{template["background"]}" alt="">'
        for key, position in template["positions"].items():
            p = Position.model_validate(position)
            body += f'<span class="fill" style="left:{p.x}%;top:{p.y}%;width:{p.width}%;font-size:{p.size}pt">{cell(values.get(key))}</span>'
    else:
        groups = {
            "Locataire / المكتري": ("customer", "birth_date", "nationality", "identity_type", "identity_number", "license", "license_issued", "address", "phone"),
            "Conducteur supplémentaire / سائق إضافي": ("driver", "driver_birth_date", "driver_nationality", "driver_identity_type", "driver_identity", "driver_license", "driver_license_issued", "driver_address", "driver_phone"),
            "Location / مدة الكراء": ("pickup", "pickup_location", "return", "return_location"),
            "Véhicule / السيارة": ("vehicle", "plate", "pickup_km", "return_km", "fuel"),
            "Montants / المبالغ": ("total", "paid", "balance", "deposit", "currency"),
        }
        sections = ""
        for title, keys in groups.items():
            rows = "".join(f'<tr><th>{cell(FIELDS[key])}</th><td>{cell(values.get(key))}</td></tr>' for key in keys)
            sections += f'<section><h2>{title}</h2><table>{rows}</table></section>'
        body = f'<h1>Contrat de location / عقد كراء سيارة</h1><p>{cell(values.get("agency"))} · {cell(values.get("agency_phone"))} · {cell(values.get("booking"))}</p><div class="groups">{sections}</div><p>Observations : {cell(values.get("notes"))}</p><div class="signatures">Signature agence / الشركة __________________<br><br>Signature client / العميل __________________</div>'
    terms = f'<section class="terms"><h2>Conditions de location / شروط الكراء</h2><p>{cell(template["terms"])}</p></section>' if template.get("terms") else ""
    return f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Contrat de location</title><style>@page{{size:A4;margin:0}}body{{margin:0;color:#111;background:white;font:10pt Arial,sans-serif}}.sheet{{position:relative;width:210mm;min-height:297mm;box-sizing:border-box;padding:10mm}}.image{{padding:0;height:297mm;overflow:hidden}}.background{{position:absolute;inset:0;width:100%;height:100%}}.fill{{position:absolute;white-space:pre-wrap;overflow-wrap:anywhere}}h2{{font-size:11pt}}.groups{{display:grid;grid-template-columns:1fr 1fr;gap:5mm}}.groups section{{break-inside:avoid}}table{{width:100%;border-collapse:collapse}}th,td{{border:1px solid #888;padding:2mm;text-align:left}}th{{width:45%}}tr{{break-inside:avoid}}h1{{font-size:17pt}}.signatures{{margin-top:12mm}}.terms{{padding:10mm;break-before:page;white-space:pre-wrap}}.help{{padding:12px}}@media print{{.help{{display:none}}}}</style></head><body>
<p class="help">Ctrl+P : imprimer ou enregistrer en PDF. Revenez dans Klynx pour confirmer que le contrat est prêt.</p><main class="sheet {"image" if template["mode"] == "image" else ""}">{body}</main>{terms}</body></html>'''


def matching_copy(order_id, description, content, limit=CONTRACT_LIMIT):
    """Reuse a readable retry artifact, never a missing or corrupted file."""
    rows = odoo.execute("ir.attachment", "search_read", [[["res_model", "=", "sale.order"], ["res_id", "=", order_id],
        ["type", "=", "binary"], ["public", "=", False], ["description", "=", description]]],
        {"fields": ["id"], "order": "id desc", "limit": 1})
    if rows:
        try:
            if attachment_content(rows[0]["id"], limit) == content:
                return rows[0]["id"]
        except HTTPException as error:
            if error.status_code != 409:
                raise
    return None


def prepare_contract(order_id, data):
    from app.routes.cars import PICKED_UP_TAG, RETURNED_TAG
    order, checklist, status = paperwork(order_id)
    if booking_status(order) != "confirmed" or any(tag in (order.get("note") or "") for tag in (PICKED_UP_TAG, RETURNED_TAG)):
        raise HTTPException(409, "Prepare paperwork for a confirmed booking before handover.")
    if not status["documents_ready"]:
        raise HTTPException(409, "Verify identity and driving licence for the client and any additional driver before preparing the contract.")
    template = company_template(order, True)
    driver = status["additional_driver"]
    if any(data.details.get(key) for key in ("driver", "driver_identity", "driver_license")) and not driver["digest"]:
        raise HTTPException(422, "Use the additional-driver form and verify their documents before including them in the contract.")
    values = contract_values(order, checklist, data.details, driver)
    fingerprint_values = [booking_digest(order), document_digest(checklist), values, template["id"]]
    if driver["digest"]:
        fingerprint_values.append(driver["digest"])
    fingerprint = digest(fingerprint_values)
    existing = read_metadata(order.get("note"), "rental_contract") or {}
    if existing.get("fingerprint") == fingerprint:
        try:
            return {"contract_id": existing["contract_id"], "html": stored_contract(order, check_documents=True)}
        except HTTPException as error:
            if error.status_code != 409:
                raise
    snapshots = []
    selected = [(item, None) for item in selected_documents(checklist)]
    if driver["digest"]:
        selected.extend((item, "additional_driver_snapshot") for item in selected_documents(driver))
    for item, scope in selected:
        content = attachment_content(item["id"])
        mime, extension = file_type(content)
        value = {"version": 1, "kind": item["kind"], "number": item["number"], "expiry_date": item["expiry_date"],
                 "verified": True, "fingerprint": fingerprint, "sha256": hashlib.sha256(content).hexdigest()}
        value.update({key: item[key] for key in ("nationality", "birth_date") if item.get(key)})
        if scope:
            value["scope"] = scope
        description = write_metadata("", "document", value)
        snapshots.append(matching_copy(order_id, description, content) or save_attachment({"name": f'{item["kind"]}.{extension}',
            "type": "binary", "datas": base64.b64encode(content).decode(), "mimetype": mime,
            "res_model": "sale.order", "res_id": order_id, "company_id": order["company_id"][0], "public": False, "description": description}))
    html = render_contract(values, template)
    sha = hashlib.sha256(html.encode()).hexdigest()
    description = write_metadata("", "rental_contract_file", {"sha256": sha})
    contract_id = matching_copy(order_id, description, html.encode()) or save_attachment({"name": f"contract-{order_id}.html", "type": "binary", "datas": base64.b64encode(html.encode()).decode(),
        "mimetype": "text/plain", "res_model": "sale.order", "res_id": order_id, "company_id": order["company_id"][0], "public": False,
        "description": description}, CONTRACT_LIMIT)
    record = {"version": 1, "contract_id": contract_id, "html_sha256": sha, "fingerprint": fingerprint, "booking_digest": booking_digest(order),
        "document_digest": document_digest(checklist), "values_digest": digest(values), "snapshot_ids": snapshots, "prepared_at": datetime.now(timezone.utc).isoformat(), "printed_at": None}
    if driver["digest"]:
        record["driver_digest"] = driver["digest"]
    note = write_metadata(write_metadata(order.get("note"), "rental_paperwork", data.details), "rental_contract", record)
    if not odoo.execute("sale.order", "write", [[order_id], {"note": note}]):
        raise HTTPException(502, "Contract could not be linked to this rental. Refresh before retrying.")
    return {"contract_id": contract_id, "html": html}


def confirm_printed(order_id, data):
    order, _, status = paperwork(order_id)
    if booking_status(order) != "confirmed" or not status["contract_current"] or data.contract_id != status["contract_id"]:
        raise HTTPException(409, "Paperwork changed. Prepare the current contract before confirming it.")
    stored_contract(order, check_documents=True)
    record = read_metadata(order.get("note"), "rental_contract")
    if not record.get("printed_at"):
        record["printed_at"] = datetime.now(timezone.utc).isoformat()
        if not odoo.execute("sale.order", "write", [[order_id], {"note": write_metadata(order.get("note"), "rental_contract", record)}]):
            raise HTTPException(502, "Contract confirmation could not be saved.")
    return {"success": True}
