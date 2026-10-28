"""Document ownership, tracking, upload bounds and read-only contract regression tests."""
import base64
from copy import deepcopy
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core import documents
from app.core.record_metadata import read_metadata, write_metadata
from app.verticals.car_rental import contracts
from app.routes import sales, booking_changes, cars

KINDS = {"cin": "CIN", "driving_license": "Driving licence"}


class Store:
    def __init__(self):
        self.attachments = []
        self.calls = []
        self.fail_write = False
        self.missing_parent = False

    def execute(self, model, method, args, kwargs=None):
        self.calls.append((model, method, deepcopy(args), kwargs))
        if model in ("res.partner", "fleet.vehicle"):
            return [] if self.missing_parent else [{"id": 3}]
        if model == "ir.attachment":
            if method == "create":
                record = {"id": len(self.attachments) + 1, **deepcopy(args[0])}
                self.attachments.append(record)
                return record["id"]
            if method == "search_read":
                def matches(record):
                    for field, operator, value in args[0]:
                        if operator == "=" and record.get(field) != value:
                            return False
                        if operator == "in" and record.get(field) not in value:
                            return False
                        if operator == "ilike" and value not in record.get(field, ""):
                            return False
                    return True
                return [deepcopy(item) for item in reversed(self.attachments) if matches(item)][: (kwargs or {}).get("limit")]
            if method == "read":
                return [deepcopy(item) for item in self.attachments if item["id"] in args[0]]
            if method == "write":
                if self.fail_write:
                    return False
                for item in self.attachments:
                    if item["id"] in args[0]:
                        item.update(args[1])
                return True
        raise AssertionError((model, method))


@pytest.fixture
def client():
    store = Store()
    app = FastAPI()
    app.include_router(documents.document_router("res.partner", KINDS), prefix="/customers")
    app.include_router(documents.document_router("fleet.vehicle", {"insurance": "Assurance"}), prefix="/cars")
    with patch.object(documents.odoo, "execute", side_effect=store.execute), TestClient(app) as test_client:
        yield test_client, store


def upload(client, **changes):
    data = {"kind": "cin", "filename": "../../identity.pdf", "content": base64.b64encode(b"%PDF-1.7\nscan").decode(),
            "number": "12345678", **changes}
    return client.post("/customers/3/documents", json=data)


def test_private_native_attachment_upload_download_and_checklist(client):
    http, store = client
    assert http.get("/customers/3/documents").json()["ready"] is False
    assert upload(http).status_code == 200
    attachment = store.attachments[0]
    assert attachment["public"] is False
    assert attachment["res_model"] == "res.partner" and attachment["res_id"] == 3
    assert attachment["name"] == "cin.pdf"
    item = http.get("/customers/3/documents").json()["documents"][0]
    assert item["status"] == "uploaded" and item["number"] == "12345678"
    result = http.get("/customers/3/documents/1/download").json()
    assert base64.b64decode(result["content"]) == b"%PDF-1.7\nscan"
    assert result["mime"] == "application/pdf"
    assert all(model != "ir.model" for model, *_ in store.calls)


def test_verification_expiry_and_replacement_do_not_delete_earlier_scans(client):
    http, store = client
    upload(http)
    upload(http, kind="driving_license")
    for attachment_id in (1, 2):
        assert http.patch(f"/customers/3/documents/{attachment_id}", json={"verified": True, "number": "456"}).status_code == 200
    assert http.get("/customers/3/documents").json()["ready"] is True
    upload(http)
    assert len(store.attachments) == 3
    assert http.get("/customers/3/documents").json()["documents"][0]["status"] == "uploaded"
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    assert http.patch("/customers/3/documents/3", json={"verified": True, "expiry_date": yesterday}).status_code == 422
    assert http.patch("/customers/3/documents/3", json={"expiry_date": yesterday}).status_code == 200
    assert http.get("/customers/3/documents").json()["documents"][0]["status"] == "expired"


@pytest.mark.parametrize("path", ["/customers/4/documents/1", "/cars/3/documents/1"])
def test_cannot_read_or_update_another_record_or_model_attachment(client, path):
    http, _ = client
    upload(http)
    assert http.get(path + "/download").status_code == 404
    assert http.patch(path, json={"verified": True}).status_code == 404


@pytest.mark.parametrize("content,status", [("garbage!", 422), (base64.b64encode(b"<svg onload=alert(1)>").decode(), 415),
                                          (base64.b64encode(b"%PDF-" + b"x" * documents.MAX_FILE_BYTES).decode(), 422)],
                         ids=["invalid-base64", "unsupported-file", "oversized-file"])
def test_invalid_unsupported_or_oversized_upload_is_rejected_before_create(client, content, status):
    http, store = client
    assert upload(http, content=content).status_code == status
    assert not store.attachments


@pytest.mark.parametrize("content,mime", [(b"%PDF-1.7", "application/pdf"), (b"\x89PNG\r\n\x1a\nscan", "image/png"),
                                         (b"\xff\xd8\xffscan", "image/jpeg")])
def test_supported_signature_controls_type_not_filename(client, content, mime):
    http, store = client
    assert upload(http, filename="scan.html", content=base64.b64encode(content).decode()).status_code == 200
    assert store.attachments[0]["mimetype"] == mime


def test_missing_parent_wrong_kind_and_failed_update_are_not_success(client):
    http, store = client
    assert upload(http, kind="insurance").status_code == 422
    store.missing_parent = True
    assert upload(http).status_code == 404
    store.missing_parent = False
    upload(http)
    store.fail_write = True
    assert http.patch("/customers/3/documents/1", json={"verified": True, "number": "12345678"}).status_code == 502


def test_untracked_or_public_attachment_is_not_downloadable(client):
    http, store = client
    upload(http)
    store.attachments[0]["public"] = True
    assert http.get("/customers/3/documents/1/download").status_code == 404
    store.attachments[0]["public"] = False
    store.attachments[0]["description"] = "Other unrelated Odoo attachment"
    assert http.get("/customers/3/documents/1/download").status_code == 404


def test_document_endpoints_directly_preserve_ownership_and_verification():
    # Pure endpoint coverage also runs when Windows cannot create TestClient's socket pair.
    store = Store()
    routes = documents.document_router("res.partner", KINDS).routes
    checklist, create, update, download = [route.endpoint for route in routes]
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        assert not checklist(3)["ready"]
        result = create(3, documents.DocumentUpload(kind="cin", filename="scan.pdf",
                        content=base64.b64encode(b"%PDF-1.7").decode(), number="123"))
        assert result["attachment_id"] == 1
        update(3, 1, documents.DocumentUpdate(number="123", verified=True))
        assert checklist(3)["documents"][0]["status"] == "verified"
        assert base64.b64decode(download(3, 1)["content"]) == b"%PDF-1.7"
        with pytest.raises(HTTPException) as error:
            download(4, 1)
        assert error.value.status_code == 404
        with pytest.raises(HTTPException):
            update(3, 1, documents.DocumentUpdate(verified=True, expiry_date=date.today() - timedelta(days=1)))
        store.fail_write = True
        with pytest.raises(HTTPException) as error:
            update(3, 1, documents.DocumentUpdate(number="123", verified=True))
        assert error.value.status_code == 502


@pytest.mark.parametrize("content", [b"<svg>bad</svg>", b"", b"%PDF-" + b"x" * documents.MAX_FILE_BYTES],
                         ids=["unsupported", "empty", "too-large"])
def test_document_upload_guard_directly(content):
    store = Store()
    create = documents.document_router("res.partner", KINDS).routes[1].endpoint
    # Oversized encoded inputs are rejected by Pydantic before the endpoint as well.
    from pydantic import ValidationError
    with patch.object(documents.odoo, "execute", side_effect=store.execute), pytest.raises((HTTPException, ValidationError)):
        create(3, documents.DocumentUpload(kind="cin", filename="bad.pdf", content=base64.b64encode(content).decode()))
    assert not store.attachments


def test_invalid_new_document_cannot_fall_back_to_an_older_verified_scan():
    store = Store()
    checklist, create, update, _ = [route.endpoint for route in documents.document_router("res.partner", KINDS).routes]
    data = documents.DocumentUpload(kind="cin", filename="scan.pdf", content=base64.b64encode(b"%PDF-1.7").decode())
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        create(3, data)
        update(3, 1, documents.DocumentUpdate(number="123", verified=True))
        create(3, data)
        assert checklist(3)["documents"][0]["status"] == "uploaded"
        store.attachments[-1]["description"] = "[Klynx metadata:document:bad]"
        with pytest.raises(HTTPException) as error:
            checklist(3)
        assert error.value.status_code == 409


class RentalStore(Store):
    def __init__(self):
        super().__init__()
        self.order = {"id": 42, "name": "S0042", "state": "sale", "partner_id": [3, "Client"], "company_id": [1, "Agency"],
                      "currency_id": [1, "TND"], "amount_total": 720, "invoice_ids": [9],
                      "date_order": f"{date.today()} 09:30:00", "commitment_date": f"{date.today() + timedelta(days=2)} 17:00:00",
                      "note": write_metadata("[Rental OS fleet.vehicle:4]", "rental_logistics", {"pickup_location": "Sousse", "return_location": "Tunis"})}
        self.vehicle = {"id": 4, "name": "Car", "license_plate": "TN123", "odometer": 1000, "odometer_unit": "kilometers", "active": True, "state_id": [1, "Réservé"], "location": "Sousse"}
        self.client = {"id": 3, "name": '<script>alert("x")</script>', "phone": "555", "street": "Street", "city": "Sousse"}
        self.paid = 1
        self.addon_lines = []

    def execute(self, model, method, args, kwargs=None):
        if model == "sale.order":
            if method in ("search_read", "read"):
                return [deepcopy(self.order)]
            if method == "write":
                self.calls.append((model, method, deepcopy(args), kwargs))
                if self.fail_write: return False
                self.order.update(args[1]); return True
        if model == "res.company":
            return [{"id": 1, "name": "Agency", "phone": "111", "partner_id": [100, "Agency contact"]}]
        if model == "sale.order.line":
            return deepcopy(self.addon_lines)
        if model == "account.move":
            return [{"amount_total": 720, "amount_residual": 720 - self.paid, "move_type": "out_invoice"}]
        if model == "res.partner": return [deepcopy(self.client)]
        if model == "fleet.vehicle": return [deepcopy(self.vehicle)]
        return super().execute(model, method, args, kwargs)


def verified_customer(store, identity="cin"):
    _, create, update, _ = [route.endpoint for route in documents.document_router("res.partner", documents.CUSTOMER_KINDS).routes]
    for kind in (identity, "driving_license"):
        result = create(3, documents.DocumentUpload(kind=kind, filename="scan.pdf", content=base64.b64encode(b"%PDF-1.7 " + kind.encode()).decode(), number="123"))
        update(3, result["attachment_id"], documents.DocumentUpdate(number="123", verified=True))


@pytest.mark.parametrize("identity", ["cin", "passport"])
def test_contact_identity_data_is_reused_by_later_rentals_without_reupload(identity):
    store = RentalStore()
    routes = documents.document_router("res.partner", documents.CUSTOMER_KINDS).routes
    checklist, _, update, _ = [route.endpoint for route in routes]
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store, identity)
        update(3, 1, documents.DocumentUpdate(number="123", nationality=" Tunisian ", birth_date=date(1995, 4, 9), verified=True))
        assert checklist(3)["ready"]  # The alternative identity remains missing.
        # An older caller can update verification without clearing these new optional fields.
        update(3, 1, documents.DocumentUpdate(number="123", verified=True))
        first = contracts.prepare_contract(42, contracts.ContractPrepare())
        assert "Tunisian" in first["html"] and "1995-04-09" in first["html"]
        copies = [item for item in store.attachments if item["res_model"] == "sale.order"]
        snapshot = next(item for item in copies if read_metadata(item["description"], "document"))
        assert read_metadata(snapshot["description"], "document")["nationality"] == "Tunisian"
        originals = [item["id"] for item in store.attachments if item["res_model"] == "res.partner"]
        store.order.update(id=43, name="S0043", note="[Rental OS fleet.vehicle:4]")
        assert sales.rental_paperwork(43)["details"] == {"nationality": "Tunisian", "birth_date": "1995-04-09"}
        second = contracts.prepare_contract(43, contracts.ContractPrepare())
        assert "Tunisian" in second["html"] and "1995-04-09" in second["html"]
        assert originals == [item["id"] for item in store.attachments if item["res_model"] == "res.partner"]
        assert first["contract_id"] != second["contract_id"]


def test_contact_identity_corrections_invalidate_current_contract_but_keep_saved_copy():
    store = RentalStore()
    update = documents.document_router("res.partner", documents.CUSTOMER_KINDS).routes[2].endpoint
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        original = contracts.prepare_contract(42, contracts.ContractPrepare())
        contracts.confirm_printed(42, contracts.ContractPrinted(contract_id=original["contract_id"]))
        update(3, 1, documents.DocumentUpdate(number="123", nationality="Tunisian", birth_date=date(1990, 1, 1), verified=True))
        assert not sales.rental_paperwork(42)["contract_ready"]
        assert contracts.stored_contract(store.order) == original["html"]
        refreshed = contracts.prepare_contract(42, contracts.ContractPrepare())
        assert refreshed["contract_id"] != original["contract_id"]
        update(3, 1, documents.DocumentUpdate(number="123", nationality="", birth_date=None, verified=True))
        assert contracts.customer_details(documents.document_checklist("res.partner", 3, documents.CUSTOMER_KINDS)) == {}


def test_identity_optional_fields_validate_birth_date_and_nationality():
    from pydantic import ValidationError
    for model in (documents.DocumentUpload, documents.DocumentUpdate):
        required = {"kind": "cin", "content": "AA==", "filename": "scan.pdf"} if model is documents.DocumentUpload else {}
        with pytest.raises(ValidationError):
            model(**required, birth_date=date.today() + timedelta(days=1))
        with pytest.raises(ValidationError):
            model(**required, nationality="x" * 101)


def test_uploaded_identity_details_are_saved_privately_and_do_not_verify_automatically():
    store = Store()
    checklist, create, _, _ = [route.endpoint for route in documents.document_router("res.partner", documents.CUSTOMER_KINDS).routes]
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        create(3, documents.DocumentUpload(kind="passport", filename="scan.pdf", content=base64.b64encode(b"%PDF-1.7 scan").decode(),
               number="AB123", nationality=" Tunisian ", birth_date=date(1995, 4, 9)))
        identity = next(item for item in checklist(3)["documents"] if item["kind"] == "passport")
        assert identity["nationality"] == "Tunisian" and identity["birth_date"] == "1995-04-09"
        assert identity["status"] == "uploaded" and not checklist(3)["ready"]
        assert store.attachments[0]["res_model"] == "res.partner" and not store.attachments[0]["public"]


@pytest.mark.parametrize("expiry,reminder", [("2030-03-31", "2030-02-28"), ("2028-03-31", "2028-02-29"),
                                           ("2030-01-15", "2029-12-15"), ("2030-07-01", "2030-06-01"),
                                           ("0001-01-01", "0001-01-01")])
def test_vehicle_expiry_reminder_is_one_calendar_month_before_expiry(expiry, reminder):
    assert documents.expiry_reminder(date.fromisoformat(expiry)) == reminder


def test_vehicle_document_expiry_reminder_persists_updates_clears_and_reads_legacy_dates():
    store = Store()
    checklist, create, update, _ = [route.endpoint for route in documents.document_router("fleet.vehicle", {"insurance": "Assurance"}).routes]
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        create(3, documents.DocumentUpload(kind="insurance", filename="scan.pdf", content=base64.b64encode(b"%PDF-1.7 scan").decode(), expiry_date=date(2030, 3, 31)))
        value = read_metadata(store.attachments[0]["description"], "document")
        assert value["reminder_date"] == "2030-02-28"
        # Existing scans retain their expiry and gain the same derived reminder in the checklist.
        del value["reminder_date"]
        store.attachments[0]["description"] = write_metadata("", "document", value)
        assert checklist(3)["documents"][0]["reminder_date"] == "2030-02-28"
        update(3, 1, documents.DocumentUpdate(expiry_date=date(2030, 1, 15)))
        assert read_metadata(store.attachments[0]["description"], "document")["reminder_date"] == "2029-12-15"
        update(3, 1, documents.DocumentUpdate(expiry_date=None))
        assert checklist(3)["documents"][0]["reminder_date"] is None
        assert read_metadata(store.attachments[0]["description"], "document")["reminder_date"] is None


def test_verified_passport_and_licence_prepare_print_and_pickup_preserve_rental_copies(monkeypatch):
    # Isolate customer paperwork; fleet eligibility is covered by test_fleet_eligibility.
    monkeypatch.setattr(booking_changes, "ensure_eligible", lambda *args: {"eligible": True})
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute), patch.object(booking_changes, "refresh_fleet"):
        verified_customer(store, "passport")
        prepared = sales.prepare_rental_contract(42, contracts.ContractPrepare())
        assert "&lt;script&gt;" in prepared["html"] and "<script>" not in prepared["html"]
        assert "09:30" in prepared["html"] and "17:00" in prepared["html"]
        assert "Sousse" in prepared["html"] and "Tunis" in prepared["html"]
        assert "عقد كراء" in prepared["html"] and "img-src data:" in prepared["html"]
        record = read_metadata(store.order["note"], "rental_contract")
        copies = [row for row in store.attachments if row["id"] in record["snapshot_ids"]]
        assert len(copies) == 2 and all(row["res_model"] == "sale.order" and row["res_id"] == 42 and not row["public"] for row in copies)
        count = len(store.attachments)
        assert sales.prepare_rental_contract(42, contracts.ContractPrepare())["contract_id"] == prepared["contract_id"]
        assert len(store.attachments) == count
        with pytest.raises(HTTPException) as error: booking_changes.mark_picked_up(42)
        assert error.value.status_code == 409 and cars.PICKED_UP_TAG not in store.order["note"]
        sales.confirm_rental_contract(42, contracts.ContractPrinted(contract_id=prepared["contract_id"]))
        assert sales.rental_paperwork(42)["contract_ready"]
        assert booking_changes.mark_picked_up(42)["success"]
        assert cars.PICKED_UP_TAG in store.order["note"]
        assert sales.rental_contract(42)["html"] == prepared["html"]
        assert not any(model == "account.move" and method == "write" for model, method, *_ in store.calls)


@pytest.mark.parametrize("change", ["dates", "vehicle", "location", "payment", "customer", "replace_document"])
def test_changed_rental_or_customer_requires_a_new_contract(change):
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        prepared = contracts.prepare_contract(42, contracts.ContractPrepare())
        contracts.confirm_printed(42, contracts.ContractPrinted(contract_id=prepared["contract_id"]))
        if change == "dates": store.order["commitment_date"] = "2030-10-10 17:00:00"
        if change == "vehicle": store.order["note"] = store.order["note"].replace("fleet.vehicle:4", "fleet.vehicle:5")
        if change == "location": store.order["note"] = write_metadata(store.order["note"], "rental_logistics", {"pickup_location": "Other"})
        if change == "payment": store.paid = 10
        if change == "customer": store.client["phone"] = "999"
        if change == "replace_document":
            documents.document_router("res.partner", documents.CUSTOMER_KINDS).routes[1].endpoint(3,
                documents.DocumentUpload(kind="cin", filename="scan.pdf", content=base64.b64encode(b"%PDF-NEW").decode(), number="123"))
        assert not contracts.paperwork(42)[2]["contract_ready"]
        with pytest.raises(HTTPException): contracts.ensure_pickup_paperwork(42)
        assert all(row["datas"] for row in store.attachments)


@pytest.mark.parametrize("kind", ["cin", "passport", "driving_license"])
def test_verification_requires_number_and_readable_scan(kind):
    store = Store()
    _, create, update, _ = [route.endpoint for route in documents.document_router("res.partner", documents.CUSTOMER_KINDS).routes]
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        create(3, documents.DocumentUpload(kind=kind, filename="scan.pdf", content=base64.b64encode(b"%PDF-1.7").decode()))
        with pytest.raises(HTTPException): update(3, 1, documents.DocumentUpdate(verified=True))
        store.attachments[0]["datas"] = False
        with pytest.raises(HTTPException): update(3, 1, documents.DocumentUpdate(number="123", verified=True))


def test_scan_readback_recovers_failed_filestore_using_bounded_private_database_copy():
    store = Store()
    def execute(model, method, args, kwargs=None):
        result = store.execute(model, method, args, kwargs)
        if method == "create": store.attachments[-1]["datas"] = False
        return result
    create = documents.document_router("res.partner", KINDS).routes[1].endpoint
    with patch.object(documents.odoo, "execute", side_effect=execute):
        create(3, documents.DocumentUpload(kind="cin", filename="scan.pdf", content=base64.b64encode(b"%PDF-1.7").decode()))
        assert documents.attachment_content(1) == b"%PDF-1.7"
    assert store.attachments[0]["public"] is False and store.attachments[0]["db_datas"]
    assert all(kwargs.get("context", {}).get("bin_size") is False for _, method, _, kwargs in store.calls if method == "read")


def test_failed_persistence_is_not_a_successful_upload():
    store = Store(); store.fail_write = True
    def execute(model, method, args, kwargs=None):
        result = store.execute(model, method, args, kwargs)
        if method == "create": store.attachments[-1]["datas"] = False
        return result
    with patch.object(documents.odoo, "execute", side_effect=execute), pytest.raises(HTTPException) as error:
        documents.save_attachment({"datas": base64.b64encode(b"%PDF-1.7").decode()})
    assert error.value.status_code == 502


def test_company_template_uses_native_company_contact_and_escapes_conditions():
    store = RentalStore()
    image = base64.b64encode(b"\x89PNG\r\n\x1a\nimage").decode()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        contracts.save_template(42, contracts.TemplateSetup(mode="image", background=image,
            positions={"customer": {"x": 5, "y": 20}}, terms="<script>unsafe</script>"))
        attachment = store.attachments[0]
        assert attachment["res_model"] == "res.partner" and attachment["res_id"] == 100 and attachment["company_id"] == 1
        template = contracts.company_template(store.order, True)
        html = contracts.render_contract({"customer": "<img onerror=bad>"}, template)
        assert "&lt;img" in html and "&lt;script&gt;" in html and '<script>' not in html
        assert "data:image/png;base64," in html and "@page{size:A4" in html


def test_contract_snapshot_download_cannot_cross_rental_and_routes_are_read_only():
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        contracts.prepare_contract(42, contracts.ContractPrepare())
        snapshots = [route for route in sales.router.routes if "/documents" in route.path and "additional-driver" not in route.path]
        assert len(snapshots) == 2 and all(route.methods == {"GET"} for route in snapshots)
        download = next(route.endpoint for route in snapshots if "download" in route.path)
        copy_id = read_metadata(store.order["note"], "rental_contract")["snapshot_ids"][0]
        assert base64.b64decode(download(42, copy_id)["content"]).startswith(b"%PDF-")
        with pytest.raises(HTTPException) as error: download(43, copy_id)
        assert error.value.status_code == 404


def test_missing_docs_and_cancelled_bookings_cannot_prepare_contracts():
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        with pytest.raises(HTTPException): contracts.prepare_contract(42, contracts.ContractPrepare())
        verified_customer(store); store.order["state"] = "cancel"
        with pytest.raises(HTTPException): contracts.prepare_contract(42, contracts.ContractPrepare())
        assert len(store.attachments) == 2


def test_failed_contract_link_reuses_saved_copies_on_retry():
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        store.fail_write = True
        with pytest.raises(HTTPException) as error:
            contracts.prepare_contract(42, contracts.ContractPrepare())
        assert error.value.status_code == 502
        assert not read_metadata(store.order["note"], "rental_contract")
        count = len(store.attachments)
        store.fail_write = False
        contracts.prepare_contract(42, contracts.ContractPrepare())
        assert len(store.attachments) == count
        assert not contracts.paperwork(42)[2]["contract_ready"]


@pytest.mark.parametrize("lost", ["contract", "snapshot"])
def test_lost_saved_paperwork_can_be_regenerated_without_replacing_customer_scans(lost):
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        prepared = contracts.prepare_contract(42, contracts.ContractPrepare())
        record = read_metadata(store.order["note"], "rental_contract")
        # Force regeneration; a missing retry artifact must not poison the next attempt.
        for row in store.attachments:
            if row["id"] == (prepared["contract_id"] if lost == "contract" else record["snapshot_ids"][0]):
                row["datas"] = False
        with pytest.raises(HTTPException):
            contracts.confirm_printed(42, contracts.ContractPrinted(contract_id=prepared["contract_id"]))
        recovered = contracts.prepare_contract(42, contracts.ContractPrepare())
        if lost == "contract":
            assert recovered["contract_id"] != prepared["contract_id"]
        else:
            assert read_metadata(store.order["note"], "rental_contract")["snapshot_ids"] != record["snapshot_ids"]
        assert contracts.stored_contract(store.order) == recovered["html"]
        assert len([row for row in store.attachments if row["res_model"] == "res.partner"]) == 2


def test_changed_contract_bytes_cannot_be_confirmed_or_used_for_pickup():
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        prepared = contracts.prepare_contract(42, contracts.ContractPrepare())
        contracts.confirm_printed(42, contracts.ContractPrinted(contract_id=prepared["contract_id"]))
        store.attachments[-1]["datas"] = base64.b64encode(b"<script>changed</script>").decode()
        with pytest.raises(HTTPException):
            contracts.ensure_pickup_paperwork(42)
        with pytest.raises(HTTPException):
            contracts.confirm_printed(42, contracts.ContractPrinted(contract_id=prepared["contract_id"]))


def test_expired_identity_requires_a_valid_alternative_and_current_licence():
    store = RentalStore()
    routes = documents.document_router("res.partner", documents.CUSTOMER_KINDS).routes
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        routes[2].endpoint(3, 1, documents.DocumentUpdate(number="123", expiry_date=date.today() - timedelta(days=1)))
        assert not contracts.paperwork(42)[2]["documents_ready"]
        verified_customer(store, "passport")
        assert contracts.paperwork(42)[2]["documents_ready"]
        routes[2].endpoint(3, store.attachments[-1]["id"], documents.DocumentUpdate(number="123", expiry_date=date.today() - timedelta(days=1)))
        assert not contracts.paperwork(42)[2]["documents_ready"]


@pytest.mark.parametrize("positions", [{"unknown": {"x": 0, "y": 0}}, {"customer": {"x": 90, "y": 10, "width": 25}}, {"customer": {"x": float("nan"), "y": 10}}])
def test_template_rejects_unknown_or_outside_page_fields(positions):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        contracts.TemplateSetup(mode="image", positions=positions)



def verified_driver(store, identity="passport"):
    contracts.save_driver(42, contracts.AdditionalDriver(name="Second driver", phone="999", address="Tunis"))
    routes = documents.document_router("sale.order", documents.CUSTOMER_KINDS, "additional_driver", contracts.driver_document_guard).routes
    for kind in (identity, "driving_license"):
        result = routes[1].endpoint(42, documents.DocumentUpload(kind=kind, filename="driver.pdf",
            content=base64.b64encode(b"%PDF-1.7 driver " + kind.encode()).decode(), number="DRIVER-123",
            nationality="French", birth_date=date(1992, 5, 6)))
        routes[2].endpoint(42, result["attachment_id"], documents.DocumentUpdate(number="DRIVER-123", verified=True))
    return routes


def test_additional_driver_is_private_rental_paperwork_not_a_crm_contact_and_requires_own_documents():
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        first = contracts.prepare_contract(42, contracts.ContractPrepare())
        contracts.confirm_printed(42, contracts.ContractPrinted(contract_id=first["contract_id"]))
        original_note = store.order["note"]
        original_contacts = [row["id"] for row in store.attachments if row["res_model"] == "res.partner"]
        contracts.save_driver(42, contracts.AdditionalDriver(name="Second driver"))
        assert store.order["note"] == original_note  # Driver PII is not written into booking fields.
        status = sales.rental_paperwork(42)
        assert not status["documents_ready"] and not status["contract_ready"]
        assert status["additional_driver"]["fee_status"] == "check_fee"
        with pytest.raises(HTTPException): contracts.prepare_contract(42, contracts.ContractPrepare())
        with pytest.raises(HTTPException): contracts.ensure_pickup_paperwork(42)
        routes = verified_driver(store)
        assert sales.additional_driver_documents(42)["ready"]
        assert original_contacts == [row["id"] for row in store.attachments if row["res_model"] == "res.partner"]
        prepared = contracts.prepare_contract(42, contracts.ContractPrepare())
        assert all(text in prepared["html"] for text in ("Second driver", "DRIVER-123", "French", "1992-05-06", "999", "Tunis"))
        status = sales.rental_paperwork(42)
        assert len(status["snapshot_ids"]) == 4 and status["documents_ready"] and not status["contract_ready"]
        assert len([row for row in status["rental_documents"] if row["id"]]) == 2
        assert len([row for row in status["additional_driver"]["rental_documents"] if row["id"]]) == 2
        contracts.confirm_printed(42, contracts.ContractPrinted(contract_id=prepared["contract_id"]))
        assert contracts.ensure_pickup_paperwork(42)["id"] == 42
        driver_id = next(row["id"] for row in contracts.driver_state(store.order)["documents"] if row["kind"] == "passport")
        with pytest.raises(HTTPException): documents.tracked_attachment("res.partner", 3, driver_id, documents.CUSTOMER_KINDS)
        with pytest.raises(HTTPException): routes[3].endpoint(43, driver_id)
        with pytest.raises(HTTPException): documents.tracked_attachment("sale.order", 42, driver_id, documents.CUSTOMER_KINDS)
        assert not any(model == "crm.lead" or model == "res.partner" and method in ("create", "write") for model, method, *_ in store.calls)


def test_driver_document_replacement_changes_contract_even_with_same_numbers_and_keeps_old_copies():
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store); routes = verified_driver(store)
        first = contracts.prepare_contract(42, contracts.ContractPrepare())
        copies = read_metadata(store.order["note"], "rental_contract")["snapshot_ids"]
        routes[1].endpoint(42, documents.DocumentUpload(kind="passport", filename="new.pdf", number="DRIVER-123",
            content=base64.b64encode(b"%PDF-1.7 replacement").decode()))
        replacement = store.attachments[-1]["id"]
        assert not contracts.paperwork(42)[2]["documents_ready"]
        routes[2].endpoint(42, replacement, documents.DocumentUpdate(number="DRIVER-123", verified=True))
        assert not contracts.paperwork(42)[2]["contract_current"]
        second = contracts.prepare_contract(42, contracts.ContractPrepare())
        assert first["contract_id"] != second["contract_id"]
        assert set(copies).issubset({row["id"] for row in store.attachments})


def test_renaming_driver_requires_fresh_scans_and_removal_clears_driver_requirement():
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store); routes = verified_driver(store)
        first = contracts.prepare_contract(42, contracts.ContractPrepare())
        driver_scan = next(row["id"] for row in contracts.driver_state(store.order)["documents"] if row["kind"] == "passport")
        contracts.save_driver(42, contracts.AdditionalDriver(name="Different driver", fee_reviewed=True))
        state = contracts.driver_state(store.order)
        assert not state["ready"] and not state["profile"]["fee_reviewed"]
        assert all(row["id"] is None for row in sales.additional_driver_documents(42)["documents"])
        with pytest.raises(HTTPException): routes[2].endpoint(42, driver_scan, documents.DocumentUpdate(number="123", verified=True))
        contracts.save_driver(42, contracts.AdditionalDriver(active=False))
        assert contracts.paperwork(42)[2]["documents_ready"] and not contracts.paperwork(42)[2]["contract_current"]
        assert contracts.stored_contract(store.order) == first["html"]
        assert "Different driver" not in contracts.prepare_contract(42, contracts.ContractPrepare())["html"]


@pytest.mark.parametrize("tag,state", [("[Rental OS picked up]", "sale"), ("[Rental OS returned]", "sale"), ("", "cancel")])
def test_driver_profile_and_scans_cannot_change_after_handover_return_or_cancellation(tag, state):
    from app.verticals.car_rental.states import PICKED_UP_TAG, RETURNED_TAG
    store = RentalStore()
    tag = PICKED_UP_TAG if "picked up" in tag else RETURNED_TAG if "returned" in tag else ""
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        routes = verified_driver(store)
        store.order.update(state=state, note=store.order["note"] + tag)
        before = deepcopy(store.attachments)
        with pytest.raises(HTTPException): contracts.save_driver(42, contracts.AdditionalDriver(name="Change"))
        with pytest.raises(HTTPException): routes[1].endpoint(42, documents.DocumentUpload(kind="cin", filename="scan.pdf", content="AA=="))
        assert store.attachments == before


@pytest.mark.parametrize("lines,expected", [([], "check_fee"), ([{"product_uom_qty": 1, "qty_invoiced": 0, "price_unit": 20}], "invoice_pending"),
    ([{"product_uom_qty": 1, "qty_invoiced": 1, "price_unit": 20}], "included"), ([{"product_uom_qty": 1, "qty_invoiced": 0, "price_unit": 0}], "included")])
def test_additional_driver_fee_guidance_respects_native_order_and_invoiced_quantities(lines, expected):
    store = RentalStore(); store.addon_lines = lines
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        assert contracts.driver_fee_status(store.order) == expected


def test_additional_driver_requires_name_past_birth_date_and_cannot_bypass_verification_with_free_text():
    from pydantic import ValidationError
    for values in ({"name": " "}, {"name": "Driver", "birth_date": date.today() + timedelta(days=1)}, {"name": "x" * 251}):
        with pytest.raises(ValidationError): contracts.AdditionalDriver(**values)
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        with pytest.raises(HTTPException): contracts.prepare_contract(42, contracts.ContractPrepare(details={"driver": "Unverified driver"}))


def test_rental_document_list_only_contains_current_customer_copies_not_driver_scans_or_old_versions():
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store); verified_driver(store)
        contracts.prepare_contract(42, contracts.ContractPrepare())
        current = set(read_metadata(store.order["note"], "rental_contract")["snapshot_ids"])
        listing = sales.rental_documents(42)
        ids = {row["id"] for row in listing["documents"] if row["id"]}
        assert len(ids) == 2 and ids <= current
        assert all(documents.metadata(row).get("scope") is None for row in store.attachments if row["id"] in ids)



def test_batch_attention_sees_missing_driver_paperwork_and_fee_acknowledgement_preserves_contract():
    store = RentalStore()
    with patch.object(documents.odoo, "execute", side_effect=store.execute):
        verified_customer(store)
        contracts.save_driver(42, contracts.AdditionalDriver(name="Second driver"))
        assert not contracts.batch_paperwork([store.order])[42]["documents_ready"]
        verified_driver(store)
        prepared = contracts.prepare_contract(42, contracts.ContractPrepare())
        contracts.confirm_printed(42, contracts.ContractPrinted(contract_id=prepared["contract_id"]))
        profile = contracts.driver_state(store.order)["profile"]
        contracts.save_driver(42, contracts.AdditionalDriver(**{**profile, "fee_reviewed": True}))
        assert contracts.paperwork(42)[2]["contract_ready"]
        assert contracts.batch_paperwork([store.order])[42]["contract_ready"]
