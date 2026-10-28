"""Reminder boundaries, optional contracts, ownership and private plan storage."""
from datetime import date, timedelta
from unittest.mock import patch
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.core.documents import checklist_from_records, expiry_reminder
from app.core.record_metadata import write_metadata, read_metadata
from app.verticals.car_rental import fleet_care as care


def vehicle():
    return {"id": 7, "name": "Car", "license_plate": "TEST", "odometer": 9500, "odometer_unit": "kilometers", "state_id": [1, "Available"]}


def scan(kind, expiry=None, verified=True, attachment_id=1):
    return {"id": attachment_id, "name": "scan.pdf", "res_id": 7,
            "description": write_metadata("", "document", {"version": 1, "kind": kind, "number": "123", "verified": verified, "payment_confirmed": True, "expiry_date": expiry})}


def complete():
    return [scan(kind, (date.today()+timedelta(days=90)).isoformat() if kind != "registration" else None) for kind in care.KINDS if kind not in care.OPTIONAL]


def test_missing_documents_red_and_optional_contracts_not_required():
    result=care.vehicle_attention(vehicle(), [])
    assert result["missing_count"] == 5
    assert {item["kind"] for item in result["alerts"]} == set(care.KINDS) - care.OPTIONAL
    assert all(item["severity"] == "danger" for item in result["alerts"])


def test_complete_fleet_ignores_unconfigured_optional_contracts():
    assert care.vehicle_attention(vehicle(),complete())["alerts"] == []
    assert checklist_from_records(complete(),care.KINDS)["ready"]


def test_renewed_scan_supersedes_expired_scan_and_preserves_history():
    old=scan("insurance",(date.today()-timedelta(days=1)).isoformat())
    new=scan("insurance",(date.today()+timedelta(days=100)).isoformat(),attachment_id=2)
    records=[new,old,*[row for row in complete() if read_metadata(row["description"],"document")["kind"]!="insurance"]]
    assert care.vehicle_attention(vehicle(),records)["alerts"] == []
    assert len(records)==6


@pytest.mark.parametrize("days,reason,severity", [(-1,"expired","danger"),(0,"renewal","warning"),(15,"renewal","warning"),(60,None,None)])
def test_insurance_expiry_boundaries(days,reason,severity):
    records=[scan("insurance",(date.today()+timedelta(days=days)).isoformat())]+[row for row in complete() if read_metadata(row["description"],"document")["kind"]!="insurance"]
    alerts=care.vehicle_attention(vehicle(),records)["alerts"]
    if reason is None: assert alerts==[]
    else: assert alerts[0]["reason"]==reason and alerts[0]["severity"]==severity


def test_month_end_renewal_window():
    assert expiry_reminder(date(2028,3,31))=="2028-02-29"
    assert expiry_reminder(date(2027,1,31))=="2026-12-31"


def test_date_missing_and_unverified_are_reminders():
    alerts=care.vehicle_attention(vehicle(),[scan("insurance",verified=False)])["alerts"]
    assert {a["reason"] for a in alerts if a["kind"]=="insurance"}=={"uploaded","date_missing"}


def test_optional_contract_only_alerts_after_upload():
    alerts=care.vehicle_attention(vehicle(),[*complete(),scan("lease",(date.today()+timedelta(days=10)).isoformat())])["alerts"]
    assert len(alerts)==1 and alerts[0]["kind"]=="lease"


@pytest.mark.parametrize("target,distance,reason", [(9500,500,"due"),(9999,500,"soon"),(10001,500,None)])
def test_oil_change_odometer_boundary(target,distance,reason):
    plan=care.MaintenancePlan(next_odometer=target,reminder_distance=distance).model_dump(mode="json")
    alerts=care.vehicle_attention(vehicle(),complete(),plan)["alerts"]
    if reason is None: assert not alerts
    else: assert alerts[0]["reason"]==reason


def test_oil_change_date_and_clearing_targets():
    plan=care.MaintenancePlan(next_date=date.today()).model_dump(mode="json")
    assert care.vehicle_attention(vehicle(),complete(),plan)["alerts"][0]["reason"]=="due"
    assert care.vehicle_attention(vehicle(),complete(),care.MaintenancePlan().model_dump(mode="json"))["alerts"]==[]


@pytest.mark.parametrize("kwargs", [{"next_odometer":-1},{"next_odometer":float("inf")},{"reminder_distance":-1}])
def test_invalid_plan_values_rejected(kwargs):
    with pytest.raises(ValidationError): care.MaintenancePlan(**kwargs)


def test_missing_owner_rejected_before_plan_write():
    with patch.object(care.odoo,"execute",return_value=[]) as execute:
        with pytest.raises(HTTPException) as error: care.save_plan(7,care.MaintenancePlan(next_odometer=10000))
    assert error.value.status_code==404 and execute.call_count==1


def test_plan_write_native_and_scoped_without_changing_actual_odometer():
    calls=[]
    def execute(model,method,args,kwargs=None):
        calls.append((model,method,args))
        if model=="fleet.vehicle": return [{"id":7}]
        return [] if method=="search_read" else 12
    with patch.object(care.odoo,"execute",side_effect=execute): care.save_plan(7,care.MaintenancePlan(next_odometer=10000))
    record=calls[-1][2][0]
    assert calls[-1][:2]==("fleet.vehicle.log.services", "create")
    assert record["vehicle_id"]==7 and "odometer" not in record
    assert care.plan_from_record({"description": record["notes"]})["next_odometer"]==10000


def test_aggregate_batches_documents_and_skips_archived_vehicles():
    calls=[]
    def execute(model,method,args,kwargs=None):
        calls.append((model,args,kwargs))
        return [vehicle()] if model=="fleet.vehicle" else complete() if model=="ir.attachment" else []
    with patch.object(care.odoo,"execute",side_effect=execute): result=care.fleet_care()
    assert len(calls)==4 and calls[0][1]==[[["active","=",True]]]
    assert ["res_id","in",[7]] in calls[1][1][0]
    assert result["vehicles"][0]["alerts"]==[]


def test_malformed_plan_visible_as_review_alert():
    bad={"id":9,"res_id":7,"name":"plan","description":write_metadata("","fleet_care",{"version":1,"next_odometer":-1})}
    with patch.object(care.odoo,"execute",side_effect=[[vehicle()],[bad,*complete()],[],[]]): result=care.fleet_care()
    assert result["vehicles"][0]["alerts"][0]["reason"]=="review"


def test_failed_plan_create_is_not_reported_as_success():
    with patch.object(care.odoo,"execute",side_effect=[[{"id":7}],[],[{"id":1}],False]):
        with pytest.raises(HTTPException) as error: care.save_plan(7,care.MaintenancePlan(next_odometer=10000))
    assert error.value.status_code==502


def test_malformed_latest_document_requires_review_instead_of_old_valid_scan():
    invalid={"id":9,"res_id":7,"name":"bad","description":"[Klynx metadata:document:invalid]"}
    with patch.object(care.odoo,"execute",side_effect=[[vehicle()],[invalid,*complete()],[],[]]): result=care.fleet_care()
    assert any(alert["reason"]=="review" for alert in result["vehicles"][0]["alerts"])


def test_renewal_survives_missing_other_scans_and_unverified_insurance():
    expiry=(date.today()+timedelta(days=10)).isoformat()
    alerts=care.vehicle_attention(vehicle(),[scan("insurance",expiry,verified=False)])["alerts"]
    assert {a["reason"] for a in alerts if a["kind"]=="insurance"}=={"uploaded","renewal"}
    assert any(a["kind"]=="registration" and a["reason"]=="missing" for a in alerts)


@pytest.mark.parametrize("state", ["Maintenance", "En entretien", "Réparation"])
def test_native_vehicle_maintenance_is_visible_without_oil_change_plan(state):
    car={**vehicle(),"state_id":[3,state]}
    assert care.vehicle_attention(car,complete())["alerts"]==[
        {"kind":"maintenance","reason":"in_progress","severity":"warning","date":None}]


def test_native_services_and_contracts_keep_their_own_reminders():
    expiry=(date.today()+timedelta(days=10)).isoformat()
    contracts=[{"id":4,"name":"Insurance in Odoo","state":"open","expiration_date":expiry,"notes":False}]
    services=[{"id":5,"state":"new","date":expiry,"description":"Tyres","service_type_id":[1,"Tyres"],"notes":False},
              {"id":6,"state":"done","date":False,"notes":False}]
    alerts=care.vehicle_attention(vehicle(),[],contracts=contracts,services=services)["alerts"]
    assert any(a.get("record_id")==4 and a["reason"]=="renewal" for a in alerts)
    assert any(a.get("record_id")==5 and a["reason"]=="planned" for a in alerts)
    assert not any(a.get("record_id")==6 for a in alerts)


def test_completed_native_plan_does_not_revive_old_attachment_reminder():
    old={"id":2,"res_id":7,"description":write_metadata("","fleet_care",{"version":1,"next_odometer":9000})}
    native={"id":3,"vehicle_id":[7,"Car"],"state":"done","notes":old["description"]}
    with patch.object(care.odoo,"execute",side_effect=[[vehicle()],[old,*complete()],[],[native]]) as execute:
        result=care.fleet_care()
    assert not result["vehicles"][0]["alerts"]
    assert all(call.args[1]=="search_read" for call in execute.call_args_list)


def test_service_date_edited_in_odoo_overrides_old_plan_metadata():
    target=(date.today()+timedelta(days=10)).isoformat()
    native={"id":3,"vehicle_id":[7,"Car"],"state":"new","date":target,
            "notes":write_metadata("","fleet_care",{"version":1,"next_date":"2020-01-01"})}
    with patch.object(care.odoo,"execute",side_effect=[[vehicle()],complete(),[],[native]]): result=care.fleet_care()
    assert result["vehicles"][0]["plan"]["next_date"]==target
    assert any(alert["kind"]=="oil_change" and alert["reason"]=="soon" for alert in result["vehicles"][0]["alerts"])
