from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.routes import sales, invoices


def test_failed_confirm_leaves_note_untouched():
    with patch.object(sales, "sale_record", return_value={"state": "draft", "note": "Terms"}), \
         patch.object(sales.odoo, "execute", side_effect=HTTPException(422, "Cannot confirm.")) as rpc, pytest.raises(HTTPException):
        sales.confirm_quotation(1)
    assert rpc.call_count == 1 and rpc.call_args.args[1] == "action_confirm"


def test_delivery_policy_reports_product_without_changing_configuration():
    line = {"product_id": [9, "Rental day"], "qty_to_invoice": 0, "qty_delivered": 0, "invoice_status": "no"}
    with patch.object(sales, "sale_record", return_value={"state": "sale", "invoice_ids": []}), \
         patch.object(sales.odoo, "execute", side_effect=[[], [line], [{"id": 9, "display_name": "Rental day", "invoice_policy": "delivery"}]]) as rpc, \
         pytest.raises(HTTPException) as failure:
        sales.create_invoice(1)
    assert failure.value.status_code == 422
    assert "Rental day" in failure.value.detail and "no delivery" in failure.value.detail
    assert all(call.args[1] in {"search", "search_read", "read"} for call in rpc.call_args_list)


def test_existing_draft_never_silently_accepts_new_deposit():
    with patch.object(sales, "sale_record", return_value={"state": "sale", "invoice_ids": [5]}), \
         patch.object(sales.odoo, "execute", return_value=[5]) as rpc, pytest.raises(HTTPException) as failure:
        sales.create_invoice(1, sales.InvoiceCreate(deposit_amount=100))
    assert failure.value.status_code == 409 and rpc.call_count == 1


def test_invoice_ids_come_from_odoo_readback():
    with patch.object(sales, "sale_record", side_effect=[{"state": "sale", "invoice_ids": [2], "amount_to_invoice": 300}, {"invoice_ids": [2, 8, 9]}]), \
         patch.object(sales.odoo, "execute", side_effect=[[], 7, True]):
        assert sales.create_invoice(1, sales.InvoiceCreate(deposit_amount=50))["invoice_ids"] == [8, 9]


def test_post_reads_real_state_and_residual():
    with patch.object(invoices.odoo, "execute", side_effect=[[{"state": "draft"}], True,
        [{"state": "posted", "amount_residual": 123, "payment_state": "not_paid"}]]) as rpc:
        assert invoices.post_invoice(5) == {"invoice_id": 5, "state": "posted", "amount_residual": 123, "payment_state": "not_paid"}
    assert [call.args[1] for call in rpc.call_args_list] == ["search_read", "action_post", "search_read"]


@pytest.mark.parametrize("state", ["paid", "in_payment"])
def test_full_payment_returns_refreshed_odoo_state(state):
    invoice = {"state": "posted", "amount_residual": 50, "move_type": "out_invoice", "company_id": [1, "Company"]}
    with patch.object(invoices.odoo, "execute", side_effect=[[invoice], [{"id": 1}], [invoice], 8, True,
        [{"payment_state": state, "amount_residual": 0, "amount_total": 50}]]):
        result = invoices.record_payment(5, invoices.PaymentCreate(amount=50, journal_id=1))
    assert result["amount_residual"] == 0 and result["payment_state"] == state


def test_residual_is_checked_again_immediately_before_wizard():
    invoice = {"state": "posted", "amount_residual": 50, "move_type": "out_invoice", "company_id": [1, "Company"]}
    with patch.object(invoices.odoo, "execute", side_effect=[[invoice], [{"id": 1}], [{**invoice, "amount_residual": 10}]]) as rpc, \
         pytest.raises(HTTPException) as failure:
        invoices.record_payment(5, invoices.PaymentCreate(amount=50, journal_id=1))
    assert failure.value.status_code == 409 and rpc.call_count == 3


@pytest.mark.parametrize('amount', [50, 20])
def test_double_click_creates_one_payment(amount):
    residual, wizards = 50, []
    def execute(model, method, args, kwargs=None):
        nonlocal residual
        if model == "account.move":
            return [{"state": "posted", "amount_residual": residual, "amount_total": 50,
                "move_type": "out_invoice", "company_id": [1, "Company"], "payment_state": "paid" if not residual else "not_paid"}]
        if model == "account.journal": return [{"id": 1}]
        if method == "create": wizards.append(args[0]); return 8
        residual -= wizards[-1]["amount"]
        return True
    def pay(_):
        try: return invoices.record_payment(5, invoices.PaymentCreate(amount=amount, journal_id=1))
        except HTTPException as error: return error.status_code
    invoices._recent_payments.clear()
    client = SimpleNamespace(profile={'code': 'atlas', 'database_name': 'fixture', 'uid': 8})
    with patch.object(invoices, 'current_client', SimpleNamespace(get=lambda: client)), patch.object(invoices.odoo, "execute", side_effect=execute), ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(pay, range(2)))
    assert len(wizards) == 1 and residual == 50 - amount
    assert sum(isinstance(result, dict) for result in results) == 1


def test_readback_failure_does_not_repeat_successful_partial_payment():
    invoice = {'state': 'posted', 'amount_residual': 50, 'move_type': 'out_invoice', 'company_id': [1, 'Company']}
    invoices._recent_payments.clear()
    client = SimpleNamespace(profile={'code': 'atlas', 'database_name': 'fixture', 'uid': 8})
    with patch.object(invoices, 'current_client', SimpleNamespace(get=lambda: client)), patch.object(invoices.odoo, 'execute',
        side_effect=[[invoice], [{'id': 1}], [invoice], 8, True, HTTPException(502, 'Readback unavailable.')]) as rpc:
        with pytest.raises(HTTPException): invoices.record_payment(5, invoices.PaymentCreate(amount=20, journal_id=1))
        with pytest.raises(HTTPException) as failure: invoices.record_payment(5, invoices.PaymentCreate(amount=20, journal_id=1))
        assert failure.value.status_code == 409 and rpc.call_count == 6


@pytest.mark.parametrize("invoice_id", [None, 5])
def test_journals_are_scoped_to_current_and_invoice_company(invoice_id):
    responses = [[{"company_id": [1, "Company"]}]]
    if invoice_id: responses.append([{"company_id": [1, "Company"]}])
    responses.append([{"id": 7, "name": "Bank"}])
    with patch.object(invoices.odoo, "_client", return_value=SimpleNamespace(profile={"uid": 8})), \
         patch.object(invoices.odoo, "execute", side_effect=responses) as rpc:
        assert invoices.get_payment_journals(invoice_id)["journals"] == [{"id": 7, "name": "Bank"}]
    assert ["company_id", "=", 1] in rpc.call_args.args[2][0]


def test_foreign_invoice_does_not_offer_journals():
    with patch.object(invoices.odoo, "_client", return_value=SimpleNamespace(profile={"uid": 8})), \
         patch.object(invoices.odoo, "execute", side_effect=[[{"company_id": [1, "Company"]}], []]) as rpc, pytest.raises(HTTPException):
        invoices.get_payment_journals(9)
    assert rpc.call_count == 2


def test_foreign_journal_never_creates_payment():
    invoice = {"state": "posted", "amount_residual": 50, "move_type": "out_invoice", "company_id": [1, "Company"]}
    with patch.object(invoices.odoo, "execute", side_effect=[[invoice], []]) as rpc, pytest.raises(HTTPException):
        invoices.record_payment(5, invoices.PaymentCreate(amount=20, journal_id=9))
    assert rpc.call_count == 2 and ["company_id", "=", 1] in rpc.call_args.args[2][0]
