"""Native CRM progression, verified paperwork and recoverable rental-action failures."""
from copy import deepcopy
import base64
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.core.bookings import CONFIRMED_TAG, QUOTATION_TAG
from app.core.documents import DocumentUpdate
from app.core.record_metadata import write_metadata
from app.odoo_client import current_client
from app.routes import booking_changes, customers, leads, sales
from app.verticals.car_rental import contracts, crm_journey as journey
from app.verticals.car_rental.states import PICKED_UP_TAG, RETURNED_TAG


def rental(order_id=42, lead_id=7, **values):
    return {"id": order_id, "name": f"S{order_id:05}", "state": "sale", "note": f"[Rental OS fleet.vehicle:4]\n{CONFIRMED_TAG}",
            "opportunity_id": [lead_id, "Rental inquiry"], "partner_id": [3, "Client"], **values}


class Store:
    def __init__(self):
        self.leads = [{"id": 7, "active": True, "stage_id": [1, "Nouveau prospect"], "team_id": False}]
        self.stages = [{"id": index, "name": names[0], "team_id": False}
                       for index, names in enumerate(journey.STAGES.values(), 1)]
        self.orders = [rental()]
        self.attachments = []
        self.calls = []
        self.fail_write = False

    def execute(self, model, method, args=None, kwargs=None):
        self.calls.append((model, method, deepcopy(args), kwargs))
        if model == "res.partner" and method == "search_read":
            return [{"id": 3}]
        if method == "search_read":
            rows = {"crm.lead": self.leads, "crm.stage": self.stages,
                    "sale.order": self.orders, "ir.attachment": self.attachments}[model]
            def matches(row):
                for field, operator, value in (args or [[]])[0] if args else []:
                    actual = row.get(field)
                    if isinstance(actual, list):
                        actual = actual[0]
                    if operator == "=" and actual != value:
                        return False
                    if operator == "!=" and actual == value:
                        return False
                    if operator == "in" and actual not in value:
                        return False
                    if operator == "ilike" and value not in (actual or ""):
                        return False
                return True
            rows = [deepcopy(row) for row in rows if matches(row)]
            if (kwargs or {}).get("order") == "id desc":
                rows.sort(key=lambda row: row["id"], reverse=True)
            return rows[:(kwargs or {}).get("limit")]
        if model == "crm.lead" and method == "write":
            if self.fail_write:
                raise HTTPException(502, "Simulated CRM outage")
            for lead in self.leads:
                if lead["id"] in args[0]:
                    lead["stage_id"] = [args[1]["stage_id"], "Updated"]
            return True
        if model == "ir.attachment" and method == "write":
            for row in self.attachments:
                if row["id"] in args[0]:
                    row.update(args[1])
            return True
        if model == "ir.attachment" and method == "read":
            return [deepcopy(row) for row in self.attachments if row["id"] in args[0]]
        raise AssertionError((model, method, args))


    def scan(self, kind, *, owner="res.partner", verified=True, **changes):
        value = {"version": 1, "kind": kind, "number": "QA-NUMBER", "verified": verified,
                 "expiry_date": None, **changes}
        self.attachments.append({"id": len(self.attachments) + 1, "res_model": owner,
            "res_id": 3 if owner == "res.partner" else 42, "type": "binary", "public": False,
            "name": "QA.pdf", "datas": base64.b64encode(b"%PDF-1.7\nQA scan").decode(),
            "checksum": "qa", "description": write_metadata("", "document", value)})


def test_prospect_navigation_and_stage_use_same_latest_linked_rental(store):
    store.leads[0].update(name="Client", email_from=False, phone=False, mobile=False,
                          create_date="2026-10-18 09:00:00")
    store.leads.append({"id": 8, "name": "Separate inquiry", "active": True})
    store.orders += [rental(43), rental(99, note="Ordinary non-rental sale")]
    result = leads.get_leads()["leads"]
    assert result[0]["rental"] == {"id": 43, "name": "S00043"}
    assert result[0]["email"] is None and result[0]["phone"] is None
    assert result[1]["rental"] is None
    # A customer match alone never links another opportunity's booking.
    assert journey.latest_rentals([8]) == {}
    assert journey.sync_order(store.orders[0])["crm_synced"] == 1
    assert store.leads[0]["stage_id"][0] == 3
    order_calls = [call for call in store.calls if call[:2] == ("sale.order", "search_read")]
    assert all(call[3]["order"] == "id desc" for call in order_calls)

@pytest.fixture
def store():
    database = Store()
    with patch.object(journey.odoo, "execute", side_effect=database.execute):
        yield database


@pytest.mark.parametrize("state,note,ready,expected", [
    ("draft", QUOTATION_TAG, True, "quotation"),
    ("sent", QUOTATION_TAG, True, "quotation"),
    ("sale", QUOTATION_TAG, True, "quotation"),
    ("sale", CONFIRMED_TAG, False, "confirmed"),
    ("sale", CONFIRMED_TAG, True, "documents"),
    ("sale", CONFIRMED_TAG + PICKED_UP_TAG, False, "pickup"),
    ("sale", CONFIRMED_TAG + PICKED_UP_TAG + RETURNED_TAG, False, "returned"),
    ("cancel", RETURNED_TAG, True, None),
])
def test_milestones_follow_persisted_journey_not_payment_or_contract(state, note, ready, expected):
    assert journey.milestone(rental(state=state, note=note), ready) == expected


def test_entire_linked_journey_and_document_verification_without_contract(store):
    store.orders[0].update(state="draft", note=f"[Rental OS fleet.vehicle:4]{QUOTATION_TAG}")
    assert journey.sync_order(store.orders[0]) == {"crm_synced": 1}
    assert store.leads[0]["stage_id"][0] == 2
    # Odoo's native sale confirmation can mark the opportunity won prematurely.
    store.orders[0]["state"] = "sale"
    store.leads[0]["stage_id"] = [6, "Location terminée"]
    journey.sync_order(store.orders[0])
    assert store.leads[0]["stage_id"][0] == 2
    store.orders[0]["note"] = f"[Rental OS fleet.vehicle:4]{CONFIRMED_TAG}"
    journey.sync_order(store.orders[0])
    assert store.leads[0]["stage_id"][0] == 3
    store.scan("passport")
    store.scan("driving_license", verified=False)
    journey.customer_documents_saved(3)
    assert store.leads[0]["stage_id"][0] == 3
    store.attachments[-1]["description"] = write_metadata("", "document", {
        "version": 1, "kind": "driving_license", "number": "QA-LICENCE", "verified": True})
    journey.customer_documents_saved(3)
    assert store.leads[0]["stage_id"][0] == 4
    store.orders[0]["note"] += PICKED_UP_TAG
    journey.sync_order(store.orders[0])
    assert store.leads[0]["stage_id"][0] == 5
    # An unfinished return is still a pickup; only the completed-return marker moves CRM.
    store.orders[0]["note"] = write_metadata(store.orders[0]["note"], "rental_return", {"status": "pending"})
    journey.sync_order(store.orders[0])
    assert store.leads[0]["stage_id"][0] == 5
    store.orders[0]["note"] += RETURNED_TAG
    journey.sync_order(store.orders[0])
    assert store.leads[0]["stage_id"][0] == 6
    assert journey.sync_order(store.orders[0]) == {"crm_synced": 0}


def test_active_additional_driver_blocks_documents_until_both_scans_verified(store):
    store.scan("cin"); store.scan("driving_license")
    profile = contracts.AdditionalDriver(name="QA Driver").model_dump(mode="json")
    store.attachments.append({"id": 3, "res_model": "sale.order", "res_id": 42, "type": "binary",
        "public": False, "description": write_metadata("", "additional_driver", profile)})
    journey.order_documents_saved(42)
    assert store.leads[0]["stage_id"][0] == 3
    for kind in ("passport", "driving_license"):
        store.scan(kind, owner="sale.order", scope="additional_driver", owner_key=contracts.digest("qa driver"))
    journey.order_documents_saved(42)
    assert store.leads[0]["stage_id"][0] == 4
    store.scan("cin", owner="sale.order", scope="additional_driver", owner_key=contracts.digest("other driver"), verified=False)
    assert journey.order_documents_saved(42) == {"crm_synced": 0}


def test_replaced_or_expired_main_document_revokes_documents_stage(store):
    store.scan("cin"); store.scan("driving_license")
    journey.sync_order(store.orders[0])
    assert store.leads[0]["stage_id"][0] == 4
    store.scan("driving_license", expiry_date=(date.today() - timedelta(days=1)).isoformat())
    journey.customer_documents_saved(3)
    assert store.leads[0]["stage_id"][0] == 3


def test_customer_document_route_updates_native_crm_immediately(store):
    store.scan("cin"); store.scan("driving_license", verified=False)
    # FastAPI versions may keep included routers nested until routing is resolved.
    document_router = next((route.original_router for route in customers.router.routes
                            if hasattr(route, "original_router")), customers.router)
    verify = next(route.endpoint for route in document_router.routes
                  if route.path.endswith("/documents/{attachment_id}") and "PATCH" in route.methods)
    result = verify(3, 2, DocumentUpdate(number="QA-LICENCE", verified=True))
    assert result["success"] and result["fleet_sync"]["crm_synced"] == 1
    assert store.leads[0]["stage_id"][0] == 4


def test_new_demand_sets_first_stage_without_regressing_an_existing_rental(store):
    store.orders = []
    store.leads[0]["stage_id"] = [3, "Odoo default"]
    journey.safe_sync([7], include_unbooked=True)
    assert store.leads[0]["stage_id"][0] == 1
    store.orders = [rental(note=f"[Rental OS fleet.vehicle:4]{CONFIRMED_TAG}{PICKED_UP_TAG}")]
    journey.safe_sync([7], include_unbooked=True)
    assert store.leads[0]["stage_id"][0] == 5


def test_latest_booking_only_and_customer_opportunities_remain_separate(store):
    store.leads.append({"id": 8, "active": True, "stage_id": [1, "New"], "team_id": False})
    store.orders += [rental(44, state="draft", note=f"[Rental OS fleet.vehicle:4]{QUOTATION_TAG}"),
                     rental(45, 8, note=f"[Rental OS fleet.vehicle:4]{CONFIRMED_TAG}{PICKED_UP_TAG}")]
    journey.sync_order(store.orders[0])
    assert [lead["stage_id"][0] for lead in store.leads] == [2, 1]
    journey.customer_documents_saved(3)
    assert [lead["stage_id"][0] for lead in store.leads] == [2, 5]


def test_cancelled_latest_lost_and_unlinked_opportunities_are_not_reactivated(store):
    store.orders += [rental(44, state="cancel"), rental(45, 8)]
    store.leads += [{"id": 8, "active": False, "stage_id": [6, "Lost"], "team_id": False},
                    {"id": 9, "active": True, "stage_id": [2, "Manual stage"], "team_id": False}]
    assert journey.synchronize() == {"crm_synced": 0}
    assert not any(method == "write" for _, method, *_ in store.calls)


def test_team_stage_precedes_global_and_ambiguous_or_missing_is_reported(store):
    store.leads[0]["team_id"] = [11, "Rental team"]
    store.stages += [{"id": 30, "name": "Reservation Confirmee", "team_id": [11, "Rental team"]},
                     {"id": 31, "name": "Réservation confirmée", "team_id": [12, "Other team"]}]
    journey.synchronize()
    assert store.leads[0]["stage_id"][0] == 30
    store.stages.append({"id": 32, "name": "Réservation confirmée", "team_id": [11, "Rental team"]})
    assert "crm_warning" in journey.synchronize()
    store.stages = []
    assert "crm_warning" in journey.synchronize()
    assert all(method != "create" for _, method, *_ in store.calls)


def test_viewer_remains_read_only_and_no_link_needs_no_extra_rpc(store):
    token = current_client.set(SimpleNamespace(profile={"role": "viewer"}))
    try:
        assert journey.synchronize() == {"crm_synced": 0}
    finally:
        current_client.reset(token)
    assert journey.sync_order({"opportunity_id": False}) == {}
    assert store.calls == []


def test_agency_stage_takes_precedence_over_an_unused_odoo_default(store):
    store.orders = []
    store.stages.append({"id": 90, "name": "New", "team_id": False})
    store.leads[0]["stage_id"] = [90, "New"]
    assert journey.safe_sync([7], include_unbooked=True) == {"crm_synced": 1}
    assert store.leads[0]["stage_id"][0] == 1


def test_one_crm_failure_does_not_prevent_other_opportunities(store):
    store.leads.append({"id": 8, "active": True, "stage_id": [1, "New"], "team_id": False})
    store.orders.append(rental(43, 8, state="draft", note=f"[Rental OS fleet.vehicle:4]{QUOTATION_TAG}"))
    execute = store.execute
    def fail_one(model, method, args=None, kwargs=None):
        if method == "write" and args[0] == [7]:
            return False
        return execute(model, method, args, kwargs)
    with patch.object(journey.odoo, "execute", side_effect=fail_one):
        result = leads.sync_journey()
    assert result["crm_synced"] == 1 and "crm_warning" in result
    assert store.leads[1]["stage_id"][0] == 2


def test_native_crm_write_failure_can_be_retried_without_replaying_rental(store):
    store.fail_write = True
    assert "crm_warning" in journey.sync_order(store.orders[0])
    assert store.leads[0]["stage_id"][0] == 1
    store.fail_write = False
    assert journey.sync_order(store.orders[0]) == {"crm_synced": 1}
    assert store.leads[0]["stage_id"][0] == 3
    assert all(model != "sale.order" or method == "search_read" for model, method, *_ in store.calls)


def test_confirmed_booking_and_pickup_stay_saved_when_crm_fails():
    order = rental(date_order=date.today().isoformat(), commitment_date=(date.today() + timedelta(days=1)).isoformat())
    with patch.object(booking_changes, "get_record", return_value=order), \
         patch.object(journey.odoo, "execute", side_effect=HTTPException(502, "Private technical error")):
        result = booking_changes.confirm_booking(42)
    assert result["booking_status"] == "confirmed" and result["crm_warning"] == journey.WARNING
    assert "Private technical" not in str(result)
    with patch.object(booking_changes, "get_record", side_effect=[order, {"active": True}]), \
         patch.object(booking_changes, "ensure_eligible"), patch.object(booking_changes, "ensure_pickup_paperwork", return_value=order), \
         patch.object(booking_changes, "refresh_fleet"), patch.object(journey, "safe_sync", return_value={"crm_warning": journey.WARNING}), \
         patch.object(journey.odoo, "execute", return_value=True) as rpc:
        result = booking_changes.mark_picked_up(42)
    assert result["success"] and result["crm_warning"] == journey.WARNING
    assert PICKED_UP_TAG in rpc.call_args.args[2][1]["note"]


def test_failed_native_sale_confirmation_never_updates_crm():
    with patch.object(sales, "sale_record", return_value=rental(state="draft")), \
         patch.object(sales.odoo, "execute", side_effect=HTTPException(422, "Cannot confirm")), \
         patch.object(sales, "sync_order") as sync, pytest.raises(HTTPException):
        sales.confirm_quotation(42)
    sync.assert_not_called()
