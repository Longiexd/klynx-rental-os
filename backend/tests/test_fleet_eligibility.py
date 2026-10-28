"""Rental safety gates, legal evidence boundaries and operational-state preservation."""
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from app.routes import cars, booking_changes
from app.verticals.car_rental import eligibility as policy
from app.verticals.car_rental.states import PICKED_UP_TAG

TODAY = date(2026, 10, 10)


def documents():
    return [{"kind": kind, "id": index + 1, "verified": True, "payment_confirmed": True,
             "expiry_date": "2026-12-31" if kind != "registration" else None}
            for index, kind in enumerate(sorted(policy.REQUIRED))]


@pytest.mark.parametrize("kind", sorted(policy.REQUIRED))
def test_every_required_evidence_blocks_when_absent(kind):
    result = policy.evaluate([doc for doc in documents() if doc["kind"] != kind], TODAY)
    assert result["blocking_reasons"] == [{"kind": kind, "reason": "missing", "severity": "danger", "date": None}]


@pytest.mark.parametrize("field,value,reason", [
    ("verified", False, "uploaded"), ("payment_confirmed", False, "payment_unconfirmed"),
    ("expiry_date", None, "date_missing"), ("expiry_date", "2026-10-09", "expired"),
    ("valid_from", "2026-10-11", "not_started"), ("coverage_active", False, "coverage_inactive"),
])
def test_invalid_insurance_blocks_even_with_a_scan(field, value, reason):
    evidence = documents()
    next(doc for doc in evidence if doc["kind"] == "insurance")[field] = value
    assert policy.evaluate(evidence, TODAY)["blocking_reasons"][0]["reason"] == reason


def test_valid_expiry_day_and_renewal_warning_do_not_block_until_after_expiry():
    evidence = documents()
    next(doc for doc in evidence if doc["kind"] == "insurance")["expiry_date"] = TODAY.isoformat()
    assert policy.evaluate(evidence, TODAY)["eligible"]
    assert not policy.evaluate(evidence, TODAY + timedelta(days=1))["eligible"]
    assert policy.evaluate(documents(), TODAY)["eligible"]  # Lease/service contracts remain optional.


def test_coverage_must_last_through_return_and_registration_has_no_invented_expiry():
    assert policy.evaluate(documents(), TODAY, date(2026, 12, 31))["eligible"]
    assert {reason["reason"] for reason in policy.evaluate(documents(), TODAY, date(2027, 1, 1))["blocking_reasons"]} == {"expires_during_rental"}


def test_read_permissions_never_fall_back_to_an_administrator():
    with patch.object(policy, "parent", side_effect=HTTPException(404, "not found")), patch.object(policy, "fleet_eligibility") as read:
        with pytest.raises(HTTPException) as error:
            policy.ensure_eligible(99)
        assert error.value.status_code == 404
        read.assert_not_called()


def test_blocked_available_vehicle_moves_to_native_unavailable_and_sync_is_idempotent():
    blocked = {"eligible": False, "blocking_reasons": []}
    with patch.object(cars, "find_state_id", return_value=8), patch.object(cars.odoo, "execute", return_value=True) as rpc:
        assert cars.sync_vehicle_state(7, vehicle={"state_id": [1, "Disponible"]}, orders=[], eligibility=blocked) == "Indisponible"
        rpc.assert_called_once_with("fleet.vehicle", "write", [[7], {"state_id": 8}])
        rpc.reset_mock()
        assert cars.sync_vehicle_state(7, vehicle={"state_id": [8, "Indisponible"]}, orders=[], eligibility=blocked) == "Indisponible"
        rpc.assert_not_called()


@pytest.mark.parametrize("state", ["Maintenance", "Nettoyage", "Indisponible"])
def test_verified_renewal_never_releases_a_manual_hold(state):
    with patch.object(cars.odoo, "execute") as rpc:
        assert cars.sync_vehicle_state(7, vehicle={"state_id": [8, state]}, orders=[], eligibility={"eligible": True}) is None
        rpc.assert_not_called()


def test_expiry_does_not_erase_the_actual_handover_state():
    order = {"id": 1, "state": "sale", "note": f"[Rental OS fleet.vehicle:7]{PICKED_UP_TAG}", "commitment_date": str(date.today() + timedelta(days=3))}
    with patch.object(cars.odoo, "execute") as rpc:
        assert cars.sync_vehicle_state(7, vehicle={"state_id": [8, "Louée"]}, orders=[order], eligibility={"eligible": False}) == "Louée"
        rpc.assert_not_called()


def test_manual_available_and_booking_confirmation_cannot_bypass_compliance():
    with patch.object(cars, "ensure_eligible", side_effect=HTTPException(409, "Insurance expired")), patch.object(cars, "set_vehicle_state") as write:
        with pytest.raises(HTTPException):
            cars.mark_available(7)
        write.assert_not_called()
    with patch.object(booking_changes, "ensure_eligible", side_effect=HTTPException(409, "Insurance expired")), patch.object(booking_changes.odoo, "execute") as write:
        with pytest.raises(HTTPException):
            booking_changes.ensure_available(7, TODAY, TODAY, 1)
        write.assert_not_called()


def test_native_cancelled_coverage_blocks_even_after_a_replacement_scan():
    from app.core.record_metadata import write_metadata
    evidence = documents()
    native = {"id": 12, "state": "closed", "notes": write_metadata("", "fleet_contract", {
        "version": 1, "kind": "insurance", "document_id": 99, "expiry_date": "2026-12-31"})}
    from app.verticals.car_rental.fleet_records import apply_contract_dates
    checklist = {"documents": [{**doc, "optional": False, "status": "verified"} for doc in evidence]}
    apply_contract_dates(checklist, [native], TODAY)
    assert policy.evaluate(checklist["documents"], TODAY)["blocking_reasons"][0]["reason"] == "coverage_inactive"


def test_compliance_reads_bulk_private_evidence_and_stays_inside_vehicle_ids():
    from app.core.record_metadata import write_metadata
    scans = [{"id": doc["id"], "res_id": 7, "name": "scan.pdf", "description": write_metadata("", "document", {
        "version": 1, "number": "VALID", **doc, "expiry_date": (date.today() + timedelta(days=90)).isoformat()})} for doc in documents()]
    with patch.object(policy.odoo, "execute", return_value=scans) as read, patch.object(policy, "fleet_records", return_value=([], [])) as native:
        result = policy.fleet_eligibility([7, 8])
    assert result[7]["eligible"] and not result[8]["eligible"]
    assert ["res_id", "in", [7, 8]] in read.call_args.args[2][0]
    assert ["public", "=", False] in read.call_args.args[2][0]
    native.assert_called_once_with([7, 8], include_services=False)


def test_invalid_tracked_metadata_requires_review_instead_of_an_available_vehicle():
    with patch.object(policy.odoo, "execute", return_value=[{"id": 1, "res_id": 7, "description": "invalid"}]), patch.object(policy, "fleet_records", return_value=([], [])):
        assert policy.fleet_eligibility([7])[7]["blocking_reasons"][0]["reason"] == "review"


def test_ready_action_preserves_a_future_reservation():
    order = {"id": 1, "state": "sale", "note": "[Rental OS fleet.vehicle:7]"}
    with patch.object(cars, "ensure_eligible"), patch.object(cars, "get_active_orders_for_vehicle", return_value=[order]), patch.object(cars, "set_vehicle_state") as write:
        cars.mark_available(7)
    write.assert_called_once_with(7, "Réservé")


def test_unavailable_labels_never_count_as_available_in_management():
    from app.routes.analytics import classify_vehicle_state
    assert classify_vehicle_state("Indisponible") == classify_vehicle_state("Unavailable") == "other"


def test_document_updates_preserve_existing_payment_and_coverage_when_older_callers_omit_them():
    from app.core import documents as storage
    from app.core.record_metadata import read_metadata, write_metadata
    value = {"version": 1, "kind": "insurance", "number": "POL", "verified": True,
             "expiry_date": "2027-12-31", "valid_from": "2026-01-01", "payment_confirmed": True}
    attachment = {"description": write_metadata("", "document", value)}
    route = next(route for route in storage.document_router("fleet.vehicle", policy.KINDS).routes if "PATCH" in route.methods)
    with patch.object(storage, "tracked_attachment", return_value=(attachment, value)), patch.object(storage, "attachment_content", return_value=b"%PDF-1.7\nscan"), patch.object(storage.odoo, "execute", return_value=True) as write:
        route.endpoint(7, 1, storage.DocumentUpdate(number="POL", verified=True, expiry_date="2027-12-31"))
    saved = read_metadata(write.call_args.args[2][1]["description"], "document")
    assert saved["payment_confirmed"] and saved["valid_from"] == "2026-01-01"


def test_pickup_checks_evidence_before_writing_handover_and_carries_return_date():
    order = {"id": 2, "state": "sale", "note": "[Rental OS fleet.vehicle:7]", "date_order": date.today().isoformat(), "commitment_date": "2027-01-02"}
    with patch.object(booking_changes, "get_record", side_effect=[order, {"active": True}]), patch.object(booking_changes, "ensure_eligible", side_effect=HTTPException(409, "Expired")) as check, patch.object(booking_changes, "ensure_pickup_paperwork") as paperwork, patch.object(booking_changes.odoo, "execute") as write:
        with pytest.raises(HTTPException): booking_changes.mark_picked_up(2)
    check.assert_called_once_with(7, date(2027, 1, 2))
    paperwork.assert_not_called()
    write.assert_not_called()


def test_failed_native_state_write_is_not_acknowledged_as_success():
    with patch.object(cars, "find_state_id", return_value=8), patch.object(cars.odoo, "execute", return_value=False):
        with pytest.raises(HTTPException) as error:
            cars.sync_vehicle_state(7, vehicle={"state_id": [1, "Disponible"]}, orders=[], eligibility={"eligible": False})
    assert error.value.status_code == 502
