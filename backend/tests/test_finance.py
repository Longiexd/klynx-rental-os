import unittest
from unittest.mock import patch
from fastapi import HTTPException
from pydantic import ValidationError
from app.routes import sales, invoices


class FinanceTests(unittest.TestCase):
    def test_confirmation_preserves_pickup(self):
        with patch.object(sales, "sale_record", return_value={"state": "draft", "date_order": "2026-12-20 00:00:00"}), patch.object(sales.odoo, "execute") as rpc:
            sales.confirm_quotation(1)
        self.assertEqual(rpc.call_args_list[0].args[1], "action_confirm")
        self.assertEqual(rpc.call_args_list[-1].args[2][1]["date_order"], "2026-12-20 00:00:00")
        self.assertIn("[Rental OS booking:quotation]", rpc.call_args_list[1].args[2][1]["note"])

    def test_deposit_uses_native_fixed_amount(self):
        with patch.object(sales, "sale_record", side_effect=[{"state": "sale", "invoice_ids": [], "amount_to_invoice": 300}, {"invoice_ids": [5]}]), \
             patch.object(sales.odoo, "execute", side_effect=[[], 7, True]) as rpc:
            sales.create_invoice(1, sales.InvoiceCreate(deposit_amount=50))
        values = rpc.call_args_list[1].args[2][0]
        self.assertEqual(values["advance_payment_method"], "fixed")
        self.assertEqual(values["fixed_amount"], 50)

    def test_invoice_uses_public_native_wizard(self):
        with patch.object(sales, "sale_record", side_effect=[{"state": "sale", "invoice_ids": []}, {"invoice_ids": [5]}]), \
             patch.object(sales.odoo, "execute", side_effect=[[], [], 7, True]) as rpc:
            self.assertEqual(sales.create_invoice(1)["invoice_ids"], [5])
        self.assertEqual(rpc.call_args_list[-1].args[:2], ("sale.advance.payment.inv", "create_invoices"))
        self.assertTrue(all(not call.args[1].startswith("_") for call in rpc.call_args_list))

    def test_repeated_invoice_action_reuses_draft(self):
        with patch.object(sales, "sale_record", return_value={"state": "sale", "invoice_ids": [5]}), patch.object(sales.odoo, "execute", return_value=[5]) as rpc:
            self.assertEqual(sales.create_invoice(1)["invoice_ids"], [5])
        self.assertEqual(rpc.call_count, 1)

    def test_foreign_article_cannot_be_modified(self):
        with patch.object(sales, "sale_record"), patch.object(sales.odoo, "execute", return_value=[]) as rpc, self.assertRaises(HTTPException):
            sales.update_line(1, 55, sales.LineUpdate(quantity=2))
        self.assertEqual(rpc.call_count, 1)
        self.assertIn(["order_id", "=", 1], rpc.call_args.args[2][0])

    def test_discount_updates_odoo_lines_in_one_write(self):
        lines = [
            {"id": 1, "qty_invoiced": 0, "qty_delivered": 0},
            {"id": 2, "qty_invoiced": 0, "qty_delivered": 0},
        ]
        with patch.object(sales, "sale_record"), patch.object(sales.odoo, "execute", side_effect=[lines, True]) as rpc:
            sales.discount_order(1, sales.OrderDiscount(discount_percent=15))
        self.assertEqual(rpc.call_args.args, ("sale.order.line", "write", [[1, 2], {"discount": 15}]))

    def test_payment_over_balance_never_creates_wizard(self):
        invoice = {"state": "posted", "amount_residual": 50, "move_type": "out_invoice", "company_id": [1, "Company"]}
        with patch.object(invoices.odoo, "execute", return_value=[invoice]) as rpc, self.assertRaises(HTTPException):
            invoices.record_payment(5, invoices.PaymentCreate(amount=100, journal_id=1))
        self.assertEqual(rpc.call_count, 1)

    def test_partial_payment_uses_native_reconciliation(self):
        invoice = {"state": "posted", "amount_residual": 300, "move_type": "out_invoice", "company_id": [1, "Company"]}
        with patch.object(invoices.odoo, "execute", side_effect=[[invoice], [{"id": 1}], [invoice], 8, True,
             [{"payment_state": "partial", "amount_residual": 250, "amount_total": 300}]]) as rpc:
            result = invoices.record_payment(5, invoices.PaymentCreate(amount=50, journal_id=1))
        self.assertEqual(result["paid"], 50)
        self.assertEqual(result["outstanding"], 250)
        self.assertEqual(rpc.call_args_list[4].args[:2], ("account.payment.register", "action_create_payments"))

    def test_invalid_money_is_rejected(self):
        for amount in [-1, 0, float("nan"), float("inf")]:
            with self.assertRaises(ValidationError): invoices.PaymentCreate(amount=amount, journal_id=1)


if __name__ == "__main__": unittest.main()
