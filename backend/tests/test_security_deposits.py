"""The REST boundary validates input and delegates money transactions to Odoo."""
from uuid import uuid4
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.odoo_client import OdooClient
from app.routes import invoices, sales
from app.verticals.car_rental.deposits import DepositSettlement, is_security_deposit


@pytest.mark.parametrize("code,expected", [("DEP-ECO", True), (" dep-suv ", True),
    ("LOC-DEP", False), ("OPT-DEP", False), (False, False), (None, False)])
def test_only_explicit_security_deposit_references_are_classified(code, expected):
    assert is_security_deposit({"default_code": code}) is expected


@pytest.mark.parametrize("amount", [0, -1, float("nan"), float("inf"), True, "20"])
def test_invalid_money_never_reaches_odoo(amount):
    with pytest.raises(ValidationError):
        DepositSettlement(request_id=uuid4(), action="refund", amount=amount, journal_id=1)


def test_settlement_uses_one_atomic_odoo_call_with_retry_identifier():
    data = DepositSettlement(request_id=uuid4(), action="refund", amount=50, journal_id=8)
    with patch.object(sales, "sale_record"), patch.object(sales, "require_deposit_addon"), \
         patch.object(sales.odoo, "execute", return_value={"already": True}) as rpc:
        assert sales.settle_security_deposit(42, data) == {"already": True}
    rpc.assert_called_once_with("sale.order", "klynx_deposit_settle", [[42], data.model_dump(mode="json")])


def test_missing_addon_blocks_only_new_accounting_actions_with_clear_error():
    with patch.object(sales.odoo, "execute", return_value=[]), pytest.raises(HTTPException) as error:
        sales.require_deposit_addon()
    assert error.value.status_code == 409
    assert "Odoo 18 Community" in error.value.detail


def test_separate_security_deposit_invoice_does_not_create_a_rental_advance():
    with patch.object(sales, "sale_record", return_value={"state": "sale"}), \
         patch.object(sales, "require_deposit_addon"), patch.object(sales.odoo, "execute", return_value={"invoice_ids": [9]}) as rpc:
        assert sales.create_invoice(42, sales.InvoiceCreate(security_deposit_only=True)) == {"invoice_ids": [9]}
    rpc.assert_called_once_with("sale.order", "klynx_create_deposit_invoice", [[42]])


def test_ambiguous_advance_and_security_deposit_invoice_does_not_write():
    with patch.object(sales, "sale_record", return_value={"state": "sale"}), \
         patch.object(sales.odoo, "execute") as rpc, pytest.raises(HTTPException):
        sales.create_invoice(42, sales.InvoiceCreate(security_deposit_only=True, deposit_amount=50))
    rpc.assert_not_called()


def test_viewer_can_read_deposit_but_cannot_create_payment_or_change_inspection():
    client = OdooClient({"endpoint": "http://odoo:8069", "role": "viewer"})
    try:
        with patch.object(client, "rpc", return_value={"held_amount": 50}) as rpc:
            assert client.execute("sale.order", "klynx_deposit_snapshot", [[42]]) == {"held_amount": 50}
            for method in ("klynx_deposit_settle", "klynx_save_return_inspection", "klynx_create_deposit_invoice"):
                with pytest.raises(HTTPException) as error:
                    client.execute("sale.order", method, [[42]])
                assert error.value.status_code == 403
            assert rpc.call_count == 1
    finally:
        client.close()


def test_credit_note_document_can_be_printed_without_enabling_incoming_payment():
    with patch.object(invoices.odoo, "execute", return_value=[{"state": "posted"}]) as rpc, \
         patch.object(invoices.odoo, "document", return_value=b"%PDF-test"):
        assert invoices.invoice_document(9).body == b"%PDF-test"
    assert ["move_type", "in", ["out_invoice", "out_refund"]] in rpc.call_args.args[2][0]
    with patch.object(invoices.odoo, "execute", return_value=[]), pytest.raises(HTTPException):
        invoices.post_invoice(9)
