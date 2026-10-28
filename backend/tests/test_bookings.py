from datetime import date, timedelta
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.routes import booking_changes as changes, rentals, calendar, cars


class BookingTests(unittest.TestCase):
    def setUp(self):
        self.start = date.today() + timedelta(days=2)
        self.end = self.start + timedelta(days=3)
        self.order = {"id": 1, "state": "sale", "note": "[Rental OS fleet.vehicle:4]", "partner_id": [2, "Client"],
                      "date_order": str(self.start), "commitment_date": str(self.end), "locked": False, "invoice_ids": [10], "amount_total": 300}
        self.line = {"id": 7, "product_id": [9, "Car"], "product_uom_qty": 3, "price_unit": 100,
                     "discount": 10, "qty_invoiced": 3, "qty_delivered": 0, "is_downpayment": False}

    def payload(self, **overrides):
        data = {"partner_id": 2, "vehicle_id": 4, "start_date": self.start, "end_date": self.end,
                "products": [{"product_id": 9, "line_id": 7, "quantity": 3, "unit_price": 100, "discount_percent": 10}]}
        data.update(overrides)
        return rentals.RentalCreate(**data)

    def records(self, model, record_id, fields):
        if model == "sale.order": return self.order
        return {"id": record_id, "active": True, "sale_ok": True}

    def test_legacy_confirmed_and_new_unconfirmed_sale_are_distinct(self):
        self.assertEqual(calendar.booking_status(self.order), "confirmed")
        self.assertEqual(calendar.booking_status({**self.order, "note": calendar.QUOTATION_TAG}), "quotation")
        self.assertEqual(calendar.booking_status({**self.order, "state": "cancel"}), "cancelled")

    def test_create_rejects_past_equal_and_reversed_dates_without_writes(self):
        for start, end in [(date.today() - timedelta(days=1), self.end), (self.start, self.start), (self.end, self.start)]:
            with patch.object(rentals.odoo, "execute") as rpc, self.assertRaises(HTTPException):
                rentals.create_rental(self.payload(start_date=start, end_date=end))
            rpc.assert_not_called()

    def test_non_finite_prices_and_discounts_are_rejected(self):
        for data in [{"unit_price": float("inf")}, {"discount_percent": 101}, {"quantity": float("nan")}]:
            with self.assertRaises(ValidationError):
                rentals.RentalProductLine(product_id=9, **data)

    def test_edit_dates_preserves_invoiced_line_id_price_and_discount(self):
        with patch.object(changes, "get_record", side_effect=self.records), patch.object(changes, "ensure_available"), \
             patch.object(changes, "refresh_fleet"), patch.object(changes.odoo, "execute", side_effect=[[self.line], True]) as rpc:
            changes.update_booking(1, self.payload(end_date=self.end + timedelta(days=1)))
        values = rpc.call_args_list[-1].args[2][1]
        self.assertEqual(values["order_line"], [])
        self.assertEqual(values["commitment_date"], f"{self.end + timedelta(days=1)} 00:00:00")

    def test_edit_preserves_times_and_locations_when_old_client_omits_them(self):
        from app.core.record_metadata import read_metadata, write_metadata
        self.order.update(date_order=f"{self.start} 09:30:00", commitment_date=f"{self.end} 17:00:00")
        self.order["note"] = write_metadata(self.order["note"], "rental_logistics", {"pickup_location": "Sousse", "return_location": "Tunis"})
        with patch.object(changes, "get_record", side_effect=self.records), patch.object(changes, "ensure_available"), \
             patch.object(changes, "refresh_fleet"), patch.object(changes.odoo, "execute", side_effect=[[self.line], True]) as rpc:
            changes.update_booking(1, self.payload())
        values = rpc.call_args.args[2][1]
        self.assertEqual(values["date_order"], f"{self.start} 09:30:00")
        self.assertEqual(values["commitment_date"], f"{self.end} 17:00:00")
        self.assertEqual(read_metadata(values["note"], "rental_logistics"), {"pickup_location": "Sousse", "return_location": "Tunis"})

    def test_same_day_booking_with_explicit_times_can_update_native_schedule(self):
        from app.core.record_metadata import read_metadata
        with patch.object(changes, "get_record", side_effect=self.records), patch.object(changes, "ensure_available"), \
             patch.object(changes, "refresh_fleet"), patch.object(changes.odoo, "execute", side_effect=[[self.line], True]) as rpc:
            changes.update_booking(1, self.payload(end_date=self.start, start_time="09:30", end_time="17:00", pickup_location="Sousse", return_location="Tunis"))
        values = rpc.call_args.args[2][1]
        self.assertEqual(values["commitment_date"], f"{self.start} 17:00:00")
        self.assertEqual(read_metadata(values["note"], "rental_logistics")["return_location"], "Tunis")

    def test_new_quotation_uses_native_times_and_vehicle_location_without_moving_vehicle(self):
        from app.core.record_metadata import read_metadata
        created = {}
        def records(model, record_id, fields):
            if model == "sale.order":
                return {"id": 1, "name": "S0001", "state": "draft", **created, "partner_id": [2, "Client"], "opportunity_id": [20, "Lead"]}
            return {"id": record_id, "name": "Record", "active": True, "sale_ok": True, "location": "Sousse"}
        def execute(model, method, args):
            if model == "crm.lead" and method == "create":
                return 20
            self.assertEqual((model, method), ("sale.order", "create"))
            created.update(args[0])
            return 1
        with patch.object(rentals, "get_record", side_effect=records), patch.object(rentals.odoo, "execute", side_effect=execute):
            result = rentals.create_rental(self.payload(end_date=self.start, start_time="09:30", end_time="17:00", return_location="Tunis"))
        self.assertTrue(result["success"])
        self.assertEqual(created["date_order"], f"{self.start} 09:30:00")
        self.assertEqual(created["commitment_date"], f"{self.start} 17:00:00")
        self.assertEqual(read_metadata(created["note"], "rental_logistics"), {"pickup_location": "Sousse", "return_location": "Tunis"})
        self.assertEqual(calendar.booking_status(created | {"state": "draft"}), "quotation")

    def test_invoiced_line_cannot_be_changed_or_removed(self):
        for products in [[{"product_id": 9, "line_id": 7, "quantity": 4}], [{"product_id": 12, "quantity": 1}]]:
            with patch.object(changes, "get_record", side_effect=self.records), patch.object(changes, "ensure_available"), \
                 patch.object(changes.odoo, "execute", return_value=[self.line]) as rpc, self.assertRaises(HTTPException) as caught:
                changes.update_booking(1, self.payload(products=products))
            self.assertEqual(caught.exception.status_code, 409)
            self.assertEqual(rpc.call_count, 1)

    def test_foreign_line_rejected_before_write(self):
        with patch.object(changes, "get_record", side_effect=self.records), patch.object(changes, "ensure_available"), \
             patch.object(changes.odoo, "execute", return_value=[self.line]) as rpc, self.assertRaises(HTTPException):
            changes.update_booking(1, self.payload(products=[{"product_id": 9, "line_id": 999, "quantity": 1}]))
        self.assertEqual(rpc.call_count, 1)

    def test_confirm_requires_net_payment(self):
        self.order["note"] += calendar.QUOTATION_TAG
        for invoices in [[], [{"amount_total": 300, "amount_residual": 300, "move_type": "out_invoice"}],
                         [{"amount_total": 300, "amount_residual": 0, "move_type": "out_invoice"},
                          {"amount_total": 300, "amount_residual": 0, "move_type": "out_refund"}]]:
            with patch.object(changes, "get_record", return_value=self.order), patch.object(changes.odoo, "execute", return_value=invoices) as rpc, \
                 self.assertRaises(HTTPException): changes.confirm_booking(1)
            self.assertEqual(rpc.call_count, 1)

    def test_partial_payment_secures_booking_and_keeps_vehicle_link(self):
        self.order["note"] += calendar.QUOTATION_TAG
        invoice = {"amount_total": 300, "amount_residual": 299, "move_type": "out_invoice"}
        with patch.object(changes, "get_record", return_value=self.order), patch.object(changes, "ensure_available"), \
             patch.object(changes, "refresh_fleet"), patch.object(changes.odoo, "execute", side_effect=[[invoice], True]) as rpc:
            self.assertEqual(changes.confirm_booking(1)["booking_status"], "confirmed")
        note = rpc.call_args_list[-1].args[2][1]["note"]
        self.assertNotIn(calendar.QUOTATION_TAG, note)
        self.assertEqual(calendar.rental_vehicle_id(note), 4)

    def test_overlap_blocks_confirmed_but_not_quotations_or_returned(self):
        with patch.object(changes, "ensure_eligible"), patch.object(changes, "get_record", return_value={"active": True}), patch.object(changes.odoo, "execute", return_value=[self.order]), self.assertRaises(HTTPException):
            changes.ensure_available(4, self.start, self.end, 2)
        for tag in [calendar.QUOTATION_TAG, cars.RETURNED_TAG]:
            with patch.object(changes, "ensure_eligible"), patch.object(changes, "get_record", return_value={"active": True}), patch.object(changes.odoo, "execute", return_value=[{**self.order, "note": self.order["note"] + tag}]):
                changes.ensure_available(4, self.start, self.end, 2)

    def test_cancel_uses_native_actions_without_touching_invoice(self):
        self.order["opportunity_id"] = [20, "Prospect"]
        with patch.object(changes, "get_record", return_value=self.order), patch.object(changes, "refresh_fleet"), patch.object(changes.odoo, "execute") as rpc:
            self.assertEqual(changes.cancel_booking(1)["booking_status"], "cancelled")
        self.assertEqual([(call.args[0], call.args[1]) for call in rpc.call_args_list],
                         [("sale.order", "action_cancel"), ("crm.lead", "action_set_lost")])

    def test_calendar_query_excludes_cancelled_orders(self):
        with patch.object(calendar.odoo, "execute", return_value=[]) as rpc:
            calendar.get_calendar(self.start, self.end)
        self.assertIn(["state", "!=", "cancel"], rpc.call_args.args[2][0])


if __name__ == "__main__": unittest.main()
