"""Native Fleet ownership, retries, legacy scans and actual odometer protection."""
from datetime import date, timedelta
import base64
from unittest.mock import patch
import pytest
from fastapi import HTTPException
from app.core.record_metadata import write_metadata
from app.core import documents
from app.verticals.car_rental import fleet_records as records, fleet_care as care


def contract(kind="insurance", identifier=8, expiry=None, saved_expiry=None):
    expiry=expiry or (date.today()+timedelta(days=90)).isoformat()
    return {"id":identifier,"state":"open","expiration_date":expiry,
            "notes":write_metadata("Staff notes",records.CONTRACT_KEY,{"version":1,"kind":kind,"document_id":2,"expiry_date":saved_expiry or expiry})}


def test_scan_links_native_contract_with_no_recurring_charge_or_attachment_move():
    expiry=(date.today()+timedelta(days=30)).isoformat()
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[],[{"id":3}],9]) as execute:
        assert records.sync_contract(7,2,{"kind":"insurance","expiry_date":expiry,"number":"POL123"})==9
    values=execute.call_args.args[2][0]
    assert values["vehicle_id"]==7 and values["expiration_date"]==expiry
    assert values["ins_ref"]=="POL123" and values["cost_frequency"]=="no"
    assert all(call.args[0]!="ir.attachment" for call in execute.call_args_list)


def test_renewal_updates_only_marked_contract_keeps_staff_notes():
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[contract()],True]) as execute:
        assert records.sync_contract(7,3,{"kind":"insurance","expiry_date":"2027-12-31"})==8
    model,method,args=execute.call_args.args
    assert model==records.CONTRACT_MODEL and method=="write" and args[0]==[8]
    assert "Staff notes" in args[1]["notes"] and "vehicle_id" not in args[1]


@pytest.mark.parametrize("rows", [[contract(),contract(identifier=9)], [{**contract(),"state":"closed"}]])
def test_ambiguous_or_closed_native_contract_not_silently_overwritten(rows):
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],rows]) as execute:
        with pytest.raises(HTTPException) as error:
            records.sync_contract(7,2,{"kind":"insurance","expiry_date":"2027-12-31"})
    assert error.value.status_code==409
    assert not any(call.args[1] in {"write","create"} for call in execute.call_args_list)


def test_native_permission_failure_keeps_scan_acknowledgement_truthful():
    with patch.object(records,"sync_contract",side_effect=HTTPException(403,"denied")):
        assert records.contract_after_save(7,2,{"kind":"insurance"})["linked"] is False


def test_explicit_legacy_link_does_not_reset_contract_date_edited_in_odoo():
    checklist={"documents":[{"id":2,"kind":"insurance","expiry_date":"2026-01-01"}]}
    with patch.object(records,"document_checklist",return_value=checklist), patch.object(records,"managed_contracts",return_value=[contract(saved_expiry="2026-01-01")]), patch.object(records,"sync_contract") as sync:
        assert records.sync_saved_contracts(7,{"insurance":"Insurance"})==[]
    sync.assert_not_called()


def test_duplicate_active_plans_rejected_and_completed_history_preserved():
    value={"version":1,"next_odometer":10000,"next_date":None,"reminder_distance":500}
    old={"id":3,"state":"done","notes":write_metadata("","fleet_care",value)}
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[old],[{"id":1}],4]) as execute:
        result=records.save_native_plan(7,value)
    assert result["service_id"]==4 and execute.call_args.args[1]=="create"
    pending={**old,"state":"new"}
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[pending,{**pending,"id":5}]]) as execute:
        with pytest.raises(HTTPException) as error: records.save_native_plan(7,value)
    assert error.value.status_code==409 and execute.call_count==2


def test_native_plan_clear_cancels_without_changing_actual_odometer():
    value={"version":1,"next_odometer":None,"next_date":None,"reminder_distance":500}
    old={"id":3,"state":"new","notes":write_metadata("","fleet_care",value)}
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[old],True]) as execute:
        records.save_native_plan(7,value)
    assert execute.call_args.args[2][1]["state"]=="cancelled"
    assert "odometer" not in execute.call_args.args[2][1]


def test_service_completion_scoped_and_writes_actual_odometer_once():
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[{"id":3,"state":"new"}],[{"odometer":9500}],True]) as execute:
        care.complete_service(7,3,care.ServiceCompletion(odometer=9600))
    domain=execute.call_args_list[1].args[2][0]
    assert ["id","=",3] in domain and ["vehicle_id","=",7] in domain
    assert execute.call_args.args[2]==[[3],{"state":"done","date":date.today().isoformat(),"odometer":9600}]
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[{"id":3,"state":"done"}]]) as execute:
        care.complete_service(7,3,care.ServiceCompletion(odometer=9600))
    assert execute.call_count==2


@pytest.mark.parametrize("reading,day", [(9400,date.today()),(9600,date.today()+timedelta(days=1))])
def test_service_completion_rejects_future_date_or_decreasing_odometer(reading,day):
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[{"id":3,"state":"new"}],[{"odometer":9500}]]) as execute:
        with pytest.raises(HTTPException) as error: care.complete_service(7,3,care.ServiceCompletion(odometer=reading,completed_on=day))
    assert error.value.status_code==422 and execute.call_count==3


def test_cross_vehicle_service_is_not_completed():
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[]]) as execute:
        with pytest.raises(HTTPException) as error: care.complete_service(7,3,care.ServiceCompletion(odometer=9600))
    assert error.value.status_code==404 and execute.call_count==2


def test_odoo_contract_edits_are_used_by_document_and_overview_checklists():
    checklist={"documents":[{"id":2,"kind":"insurance","expiry_date":"2020-01-01","verified":True,"optional":False,"status":"expired"}]}
    native=contract(expiry=(date.today()+timedelta(days=90)).isoformat(), saved_expiry="2020-01-01")
    records.apply_contract_dates(checklist,[native])
    assert not checklist["ready"] and checklist["documents"][0]["expiry_date"]==native["expiration_date"]
    assert checklist["documents"][0]["status"]=="uploaded"
    with patch.object(records.odoo,"execute",side_effect=[[{"id":7}],[native],True]) as execute:
        records.sync_contract(7,2,{"kind":"insurance","expiry_date":None})
    assert execute.call_args.args[2][1]["expiration_date"] is False


def test_failed_contract_sync_does_not_replace_new_scan_date_with_old_contract_date():
    doc={"id":3,"kind":"insurance","expiry_date":"2027-12-31","verified":False,"optional":False,"status":"uploaded"}
    native=contract()
    checklist={"documents":[doc]}
    records.apply_contract_dates(checklist,[native])
    assert doc["expiry_date"]=="2027-12-31" and records.document_needs_link(doc,[native])


def test_upload_stays_saved_when_subsequent_native_link_fails():
    router=documents.document_router("fleet.vehicle",{"insurance":"Insurance"},after_save=records.contract_after_save)
    upload=router.routes[1].endpoint
    with patch.object(documents,"parent"), patch.object(documents,"save_attachment",return_value=2) as save, patch.object(records,"sync_contract",side_effect=HTTPException(403,"denied")):
        response=upload(7,documents.DocumentUpload(kind="insurance",filename="policy.pdf",content=base64.b64encode(b"%PDF-1.7").decode(),expiry_date=date.today()))
    assert response["success"] is True and response["attachment_id"]==2 and response["fleet_sync"]["linked"] is False
    assert save.call_args.args[0]["res_model"]=="fleet.vehicle" and save.call_args.args[0]["public"] is False
