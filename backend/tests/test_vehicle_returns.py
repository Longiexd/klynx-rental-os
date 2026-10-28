"""Stateful return tests: separate Odoo RPCs, retry safety and booking isolation."""
from copy import deepcopy
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.bookings import CONFIRMED_TAG, QUOTATION_TAG
from app.core.record_metadata import read_metadata, write_metadata
from app.routes import cars
from app.verticals.car_rental.returns import RETURN_RECORD_KEY, can_return, return_record
from app.verticals.car_rental.states import PICKED_UP_TAG, RETURNED_TAG, booking_state


@pytest.fixture(autouse=True)
def valid_fleet_evidence():
    # Return retry/state tests use eligible vehicles; blocked returns are tested separately.
    with patch.object(cars, "ensure_eligible", return_value={"eligible": True}):
        yield


def booking(order_id=42, **changes):
    return {"id": order_id, "name": f"S{order_id}", "state": "sale", "partner_id": [3, "Test client"],
            "date_order": str(date.today() - timedelta(days=2)),
            "commitment_date": str(date.today() + timedelta(days=1)),
            "note": f"Client terms\n[Rental OS fleet.vehicle:4]\n{CONFIRMED_TAG}\n{PICKED_UP_TAG}",
            **changes}


class FakeOdoo:
    def __init__(self):
        self.orders = {42: booking(), 43: booking(43, date_order=str(date.today() + timedelta(days=5)),
                                                note=f"[Rental OS fleet.vehicle:4]{CONFIRMED_TAG}")}
        self.vehicle = {"id": 4, "name": "Test car", "license_plate": "TEST-4", "active": True,
                        "state_id": [2, "Louée"], "odometer": 12000.0, "odometer_unit": "kilometers"}
        self.states = {"Nettoyage": 3, "Disponible": 1, "Maintenance": 5}
        self.writes = []
        self.odometer_history = []
        self.fail_at = None
        self.failure_mode = "raise"

    def execute(self, model, method, args, kwargs=None):
        if method == "search_read":
            if model == "fleet.vehicle.state":
                return [{"id": self.states[args[0][0][2]]}]
            if model == "fleet.vehicle":
                return [deepcopy(self.vehicle)] if args[0][0][2] == self.vehicle["id"] else []
            if model == "sale.order":
                for clause in args[0]:
                    if isinstance(clause, list) and clause[:2] == ["id", "="]:
                        order = self.orders.get(clause[2])
                        return [deepcopy(order)] if order else []
                return [deepcopy(order) for order in self.orders.values()]
        if method == "write":
            self.writes.append((model, deepcopy(args)))
            if self.fail_at == len(self.writes):
                if self.failure_mode == "false":
                    return False
                raise HTTPException(502, "Test Odoo interruption")
            if model == "sale.order":
                self.orders[args[0][0]].update(args[1])
            elif model == "fleet.vehicle":
                self.vehicle.update(args[1])
                if "state_id" in args[1]:
                    self.vehicle["state_id"] = [args[1]["state_id"], next(name for name, value in self.states.items() if value == args[1]["state_id"])]
                if "odometer" in args[1]:
                    self.odometer_history.append(args[1]["odometer"])
            return True
        raise AssertionError((model, method, args))


@pytest.fixture
def database():
    store = FakeOdoo()
    with patch.object(cars.odoo, "execute", side_effect=store.execute):
        yield store


def request(**changes):
    return cars.ReturnRequest(order_id=42, odometer=12500.0, return_notes=" Checked ",
                              damage_notes=" Door scratch ", **changes)


@pytest.mark.parametrize("next_state", ["Nettoyage", "Disponible", "Maintenance"])
def test_return_updates_odometer_and_only_selected_booking(database, next_state):
    future_note = database.orders[43]["note"]
    result = cars.confirm_return(4, request(next_state=next_state))
    saved = return_record(database.orders[42]["note"])
    assert saved.status == "completed"
    assert saved.previous_odometer == 12000
    assert saved.odometer == database.vehicle["odometer"] == 12500
    assert saved.returned_at.tzinfo is not None
    assert saved.return_notes == "Checked" and saved.damage_notes == "Door scratch"
    assert "Client terms" in database.orders[42]["note"]
    assert RETURNED_TAG in database.orders[42]["note"]
    assert database.orders[43]["note"] == future_note
    assert booking_state([database.orders[42]]) is None
    assert result["order_id"] == 42 and result["state"] == next_state
    assert database.vehicle["state_id"][1] == next_state
    assert database.odometer_history == [12500]


def test_second_collected_booking_is_not_returned(database):
    database.orders[43] = booking(43)
    cars.confirm_return(4, request())
    assert RETURNED_TAG not in database.orders[43]["note"]


def test_return_moves_vehicle_to_native_odoo_return_location(database):
    database.orders[42]["note"] = write_metadata(database.orders[42]["note"], "rental_logistics",
        {"pickup_location": "Sousse", "return_location": "Tunis agency"})
    cars.confirm_return(4, request())
    assert database.vehicle["location"] == "Tunis agency"
    database.vehicle["location"] = "Maintenance depot"
    cars.confirm_return(4, request())
    assert database.vehicle["location"] == "Maintenance depot"


def test_completed_retry_never_overwrites_later_manual_state_or_mileage(database):
    cars.confirm_return(4, request())
    database.vehicle.update(state_id=[5, "Maintenance"], odometer=13000)
    writes = len(database.writes)
    result = cars.confirm_return(4, request())
    assert result["already"] is True
    assert len(database.writes) == writes
    assert database.vehicle["state_id"] == [5, "Maintenance"]
    assert database.vehicle["odometer"] == 13000


@pytest.mark.parametrize("stage", [1, 2, 3])
@pytest.mark.parametrize("mode", ["raise", "false"])
def test_interrupted_return_can_resume_without_duplicate_odometer_history(database, stage, mode):
    database.fail_at, database.failure_mode = stage, mode
    with pytest.raises(HTTPException):
        cars.confirm_return(4, request())
    assert RETURNED_TAG not in database.orders[42]["note"]
    saved = return_record(database.orders[42]["note"])
    assert saved is None if stage == 1 else saved.status == "pending"
    if stage == 3:
        assert database.vehicle["odometer"] == 12500
    database.fail_at = None
    cars.confirm_return(4, request())
    assert return_record(database.orders[42]["note"]).status == "completed"
    assert database.odometer_history == [12500]


def test_pending_return_rejects_changed_values_and_exposes_saved_form(database):
    database.fail_at = 2
    with pytest.raises(HTTPException):
        cars.confirm_return(4, request())
    database.fail_at = None
    writes = len(database.writes)
    with pytest.raises(HTTPException) as error:
        cars.confirm_return(4, cars.ReturnRequest(order_id=42, odometer=12600))
    assert error.value.status_code == 409
    assert len(database.writes) == writes
    options = cars.return_options(4)
    assert [order["id"] for order in options["bookings"]] == [42]
    assert options["bookings"][0]["pending_return"]["odometer"] == 12500


@pytest.mark.parametrize("reading", [-1, float("nan"), float("inf"), "12500", True])
def test_invalid_reading_is_rejected_by_request_validation(reading):
    with pytest.raises(ValidationError):
        cars.ReturnRequest(order_id=42, odometer=reading)


def test_lower_reading_is_rejected_before_any_write(database):
    with pytest.raises(HTTPException) as error:
        cars.confirm_return(4, cars.ReturnRequest(order_id=42, odometer=11999))
    assert error.value.status_code == 409
    assert database.writes == []


def test_equal_reading_changes_state_without_duplicate_history(database):
    cars.confirm_return(4, cars.ReturnRequest(order_id=42, odometer=12000))
    assert database.odometer_history == []
    assert database.vehicle["state_id"][1] == "Nettoyage"


@pytest.mark.parametrize("change", [{"state": "draft"}, {"state": "cancel"},
    {"note": f"[Rental OS fleet.vehicle:4]{QUOTATION_TAG}"},
    {"note": f"[Rental OS fleet.vehicle:4]{CONFIRMED_TAG}"},
    {"note": f"[Rental OS fleet.vehicle:4]{RETURNED_TAG}"},
    {"note": f"[Rental OS fleet.vehicle:5]{PICKED_UP_TAG}"}])
def test_wrong_or_uncollected_booking_cannot_be_returned(database, change):
    database.orders[42].update(change)
    with pytest.raises(HTTPException) as error:
        cars.confirm_return(4, request())
    assert error.value.status_code == 409
    assert database.writes == []


def test_explicit_booking_requires_mileage_but_legacy_body_keeps_existing_reading(database):
    with pytest.raises(HTTPException) as error:
        cars.confirm_return(4, cars.ReturnRequest(order_id=42))
    assert error.value.status_code == 422
    cars.confirm_return(4, cars.ReturnRequest(next_state="Disponible"))
    assert database.vehicle["odometer"] == 12000
    assert database.odometer_history == []
    assert return_record(database.orders[42]["note"]).odometer is None


def test_legacy_pending_return_without_mileage_can_resume(database):
    database.fail_at = 2
    with pytest.raises(HTTPException):
        cars.confirm_return(4, cars.ReturnRequest())
    database.fail_at = None
    cars.confirm_return(4, cars.ReturnRequest(order_id=42))
    assert return_record(database.orders[42]["note"]).status == "completed"
    assert database.odometer_history == []


def test_legacy_body_rejects_ambiguous_bookings(database):
    database.orders[43] = booking(43)
    with pytest.raises(HTTPException) as error:
        cars.confirm_return(4, cars.ReturnRequest())
    assert error.value.status_code == 409
    assert database.writes == []


def test_missing_booking_and_vehicle_do_not_write(database):
    with pytest.raises(HTTPException) as error:
        cars.confirm_return(4, cars.ReturnRequest(order_id=999, odometer=12500))
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        cars.return_options(999)
    assert error.value.status_code == 404
    assert database.writes == []


def test_legacy_collected_rentals_still_work_and_future_ones_do_not():
    assert can_return(booking(note="[Rental OS fleet.vehicle:4]"))
    assert not can_return(booking(note="[Rental OS fleet.vehicle:4]", date_order=str(date.today() + timedelta(days=1))))


@pytest.mark.parametrize("payload", ["invalid", "e30=", "!!!"])
def test_corrupt_return_metadata_is_not_silently_overwritten(database, payload):
    database.orders[42]["note"] += f"[Klynx metadata:{RETURN_RECORD_KEY}:{payload}]"
    with pytest.raises(HTTPException) as error:
        cars.confirm_return(4, request())
    assert error.value.status_code == 409
    assert database.writes == []


def test_notes_support_arabic_plain_text_and_preserve_other_metadata():
    original = write_metadata("Rental terms", "documents", {"cin": "verified"})
    note = write_metadata(original, RETURN_RECORD_KEY, {"return_notes": "م" * 4000, "damage_notes": "ع" * 4000})
    assert read_metadata(note, "documents") == {"cin": "verified"}
    assert read_metadata(note, RETURN_RECORD_KEY)["return_notes"] == "م" * 4000


def test_miles_are_retained_without_conversion(database):
    database.vehicle["odometer_unit"] = "miles"
    result = cars.confirm_return(4, request())
    assert result["return_record"]["odometer_unit"] == "miles"
    assert database.vehicle["odometer"] == 12500


@pytest.mark.parametrize("next_state", ["Rented", "", "Unknown"])
def test_invalid_next_state_does_not_write(database, next_state):
    with pytest.raises(HTTPException) as error:
        cars.confirm_return(4, request(next_state=next_state))
    assert error.value.status_code == 400
    assert database.writes == []


@pytest.mark.parametrize("next_state", ["Nettoyage", "Maintenance"])
def test_expired_evidence_does_not_prevent_recording_a_real_return(database, next_state):
    with patch.object(cars, "ensure_eligible", side_effect=HTTPException(409, "Expired")) as check:
        cars.confirm_return(4, request(next_state=next_state))
    check.assert_not_called()
    assert database.vehicle["odometer"] == 12500


def test_return_cannot_release_an_ineligible_car_as_available(database):
    with patch.object(cars, "ensure_eligible", side_effect=HTTPException(409, "Expired")):
        with pytest.raises(HTTPException): cars.confirm_return(4, request(next_state="Disponible"))
    assert database.writes == [] and database.odometer_history == []


def test_inspection_and_explicit_damage_survive_interrupted_return(database):
    inspection = {"body_checked": True, "interior_checked": True, "fuel_keys_checked": True, "approved": False}
    body = request(next_state="Maintenance", damaged=True, inspection=inspection)
    database.fail_at = 2
    with pytest.raises(HTTPException):
        cars.confirm_return(4, body)
    saved = return_record(database.orders[42]["note"])
    assert saved.damaged and saved.inspection.complete() and not saved.inspection.approved
    assert saved.inspected_at.tzinfo is not None
    database.fail_at = None
    cars.confirm_return(4, body)
    assert return_record(database.orders[42]["note"]).damaged
    assert database.vehicle["state_id"][1] == "Maintenance"


@pytest.mark.parametrize("inspection,damaged,notes", [
    ({"approved": True}, False, ""),
    ({"body_checked": True, "interior_checked": True, "fuel_keys_checked": True, "approved": True}, True, "Scratch"),
    ({}, True, " "),
])
def test_false_approval_or_undocumented_damage_is_rejected(inspection, damaged, notes):
    with pytest.raises(ValidationError):
        cars.ReturnRequest(order_id=42, odometer=12500, inspection=inspection, damaged=damaged, damage_notes=notes)


def test_damaged_car_cannot_be_returned_as_available(database):
    with pytest.raises(HTTPException):
        cars.confirm_return(4, request(next_state="Disponible", damaged=True))
    assert database.writes == []


def test_pending_inspection_cannot_be_changed_on_retry(database):
    body = request(inspection={"body_checked": True})
    database.fail_at = 2
    with pytest.raises(HTTPException):
        cars.confirm_return(4, body)
    database.fail_at = None
    with pytest.raises(HTTPException) as error:
        cars.confirm_return(4, request(inspection={"body_checked": True, "interior_checked": True}))
    assert error.value.status_code == 409
