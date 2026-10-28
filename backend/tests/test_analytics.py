import unittest
from datetime import date
from unittest.mock import patch

from app.routes import analytics
from app.core.record_metadata import write_metadata


class FakeOdoo:
    def __init__(self):
        self.calls = []
        self.orders = [
            dict(id=1, name="S001", partner_id=[1, "Client"], state="sale",
                 date_order="2026-01-10 09:00:00", amount_total=120,
                 note="[Rental OS fleet.vehicle:7]"),
            dict(id=2, name="S002", partner_id=[1, "Client"], state="sale",
                 date_order="2026-02-10 09:00:00", amount_total=300,
                 note="[Rental OS fleet.vehicle:8]"),
            dict(id=3, name="S003", partner_id=[1, "Client"], state="sale",
                 date_order="2026-03-10 09:00:00", amount_total=80,
                 note="[Rental OS fleet.vehicle:7]"),
            dict(id=4, name="S004", partner_id=[1, "Client"], state="draft",
                 date_order="2026-03-12 09:00:00", amount_total=999,
                 note="[Rental OS fleet.vehicle:7]"),
            dict(id=5, name="S005", partner_id=[1, "Client"], state="sale",
                 date_order="2025-01-10 09:00:00", amount_total=100,
                 note="[Rental OS fleet.vehicle:7]"),
        ]
        self.lines = [dict(id=1, order_id=[1, "S001"], product_id=[30, "Rental"], price_total=100),
                      dict(id=2, order_id=[1, "S001"], product_id=[31, "Baby seat"], price_total=20),
                      dict(id=3, order_id=[2, "S002"], product_id=[32, "Rental"], price_total=300),
                      dict(id=4, order_id=[3, "S003"], product_id=[30, "Rental"], price_total=80)]
        self.products = [dict(id=30, categ_id=[20, "SUV"]), dict(id=31, categ_id=[21, "Accessories"]),
                         dict(id=32, categ_id=[22, "Economy"])]
        for order in self.orders:
            order['company_id'] = [1, 'Agency']
        self.retention_moves = []
        self.invoices = [dict(id=1, order_id=1, company_id=[1, 'Agency'], amount_total=120, amount_residual=20, move_type="out_invoice"),
                         dict(id=2, order_id=2, company_id=[1, 'Agency'], amount_total=300, amount_residual=0, move_type="out_invoice"),
                         dict(id=3, order_id=1, company_id=[1, 'Agency'], amount_total=10, amount_residual=0, move_type="out_refund")]

    def execute(self, model, method, args, kwargs):
        self.calls.append((model, method, args, kwargs))
        if method != "search_read":
            raise AssertionError("Analytics must only read Odoo")
        domain = {item[0]: item[2] for item in args[0] if isinstance(item, (list, tuple))}
        if model == "sale.order":
            dates = {operator: value for field, operator, value in args[0]
                     if field == "date_order"}
            return [order for order in self.orders
                    if order["state"] in domain["state"]
                    and dates[">="] <= order["date_order"] < dates["<"]]
        if model == "fleet.vehicle":
            if "active" in domain:
                return [dict(id=7, state_id=[1, "Loué"]), dict(id=8, state_id=[2, "Disponible"])]
            return [dict(id=7, name="Same model", license_plate="AA-7", category_id=[10, "SUV"]),
                    dict(id=8, name="Same model", license_plate="AA-8", category_id=[11, "Economy"])]
        if model == "sale.order.line":
            return [line for line in self.lines if line["order_id"][0] in domain["order_id"]]
        if model == "product.product":
            return self.products
        if model == "account.move":
            if 'id' in domain and domain.get('move_type') == 'entry':
                return [move for move in self.retention_moves if move['id'] in domain['id']
                        and move['state'] == domain['state'] and move['move_type'] == domain['move_type']]
            if 'reversed_entry_id' in domain:
                return [move for move in self.retention_moves if move.get('reversed_entry_id', [None])[0] in domain['reversed_entry_id']
                        and move['state'] == domain['state']]
            order_ids = domain.get("invoice_line_ids.sale_line_ids.order_id")
            return [invoice for invoice in self.invoices if (order_ids is None
                    or invoice.get("order_id") in order_ids or invoice['id'] in domain.get('id', []))
                    and (not domain.get('company_id') or invoice['company_id'][0] in domain['company_id'])]
        raise AssertionError(f"Unexpected Odoo model: {model}")


class AnalyticsTests(unittest.TestCase):
    def get_report(self, vehicle_id=None, database=None):
        self.odoo = database or FakeOdoo()
        with patch.object(analytics, "odoo", self.odoo), patch.object(analytics, "fleet_eligibility", side_effect=lambda ids: {i: {"eligible": True} for i in ids}):
            return analytics.get_analytics(year=2026, start_date=date(2026, 1, 1),
                                           end_date=date(2026, 12, 31), vehicle_id=vehicle_id)

    def test_demand_uses_vehicle_ids_and_confirmed_orders(self):
        report = self.get_report()
        self.assertEqual(report["summary"]["revenue"], 500)
        self.assertEqual(report["summary"]["orders"], 3)
        self.assertEqual([(row["id"], row["orders"]) for row in report["vehicles"]], [(7, 2), (8, 1)])
        self.assertEqual({row["vehicle_id"] for row in report["orders"]}, {7, 8})
        self.assertEqual({row["name"]: row["revenue"] for row in report["product_categories"]},
                         {"SUV": 180, "Accessories": 20, "Economy": 300})
        self.assertEqual({row["name"]: row["revenue"] for row in report["fleet_categories"]},
                         {"SUV": 200, "Economy": 300})

    def test_vehicle_filter_scopes_orders_comparison_and_linked_invoices(self):
        report = self.get_report(7)
        self.assertEqual(report["summary"], dict(revenue=200, orders=2, average_order=100,
                                                invoiced=110, collected=90, outstanding=20))
        self.assertEqual(report["comparison"], dict(revenue_change=100, orders_change=100))
        self.assertEqual(sum(row["orders"] for row in report["monthly"]), 2)
        self.assertEqual([row["id"] for row in report["vehicles"]], [7])
        self.assertEqual({row["id"] for row in report["vehicle_options"]}, {7, 8})

    def test_unknown_vehicle_is_empty_without_losing_filter_options(self):
        report = self.get_report(999)
        self.assertEqual(report["summary"]["revenue"], 0)
        self.assertEqual(report["vehicles"], [])
        self.assertEqual(len(report["vehicle_options"]), 2)

    def deposit_database(self, retained=None):
        database = FakeOdoo()
        database.products.append(dict(id=33, default_code=" dep-guarantee ", categ_id=[23, "Cautions"]))
        database.lines.extend([
            dict(id=5, order_id=[1, "S001"], product_id=[33, "Guarantee"], price_total=1000),
            dict(id=6, order_id=[5, "S005"], product_id=[33, "Guarantee"], price_total=2000),
        ])
        database.orders[0]["amount_total"] += 1000
        database.orders[4]["amount_total"] += 2000
        if retained is not None:
            database.retention_moves.append(dict(id=101, company_id=[1, 'Agency'], state='posted',
                                                 move_type='entry', amount_total_signed=retained))
            database.orders[0]["note"] = write_metadata(database.orders[0]["note"], "security_deposit",
                                                        {"retained_amount": retained, 'events': [
                                                            {'action': 'retain', 'move_id': 101, 'amount': retained}]})
        return database

    def test_security_deposits_never_inflate_revenue_or_category_rankings(self):
        report = self.get_report(database=self.deposit_database())
        self.assertEqual(report["summary"]["revenue"], 500)
        self.assertEqual(report["summary"]["average_order"], 166.67)
        self.assertEqual(report["comparison"]["revenue_change"], 400)
        self.assertEqual(sum(row["revenue"] for row in report["monthly"]), 500)
        self.assertEqual(sum(row["amount"] for row in report["orders"]), 500)
        self.assertEqual(sum(row["revenue"] for row in report["vehicles"]), 500)
        self.assertEqual(sum(row["revenue"] for row in report["fleet_categories"]), 500)
        self.assertEqual(report["customers"][0]["revenue"], 500)
        self.assertEqual(report["product_categories"][0]["name"], "Economy")
        self.assertNotIn("Cautions", {row["name"] for row in report["product_categories"]})

    def test_only_retained_damage_amount_becomes_income(self):
        report = self.get_report(7, self.deposit_database(retained=125))
        self.assertEqual(report["summary"]["revenue"], 325)
        self.assertEqual(report["comparison"]["revenue_change"], 225)
        self.assertEqual(report["monthly"][0]["revenue"], 245)
        self.assertEqual(report["vehicles"][0]["revenue"], 325)
        categories = {row["name"]: row["revenue"] for row in report["product_categories"]}
        self.assertEqual(categories, {"SUV": 180, "Accessories": 20, "Damage compensation": 125})

    def test_refunded_deposit_is_not_negative_revenue(self):
        database = self.deposit_database()
        database.orders[0]["note"] = write_metadata(database.orders[0]["note"], "security_deposit",
                                                    {"refunded_amount": 1000, "retained_amount": 0})
        report = self.get_report(database=database)
        self.assertEqual(report["summary"]["revenue"], 500)

    def test_legacy_metadata_cannot_recognize_more_income_than_the_deposit(self):
        for invalid, expected in [(1500, 1500), (-10, 500), ("NaN", 500), ("Infinity", 500), ("invalid", 500)]:
            with self.subTest(retained=invalid):
                self.assertEqual(self.get_report(database=self.deposit_database(invalid))["summary"]["revenue"], expected)

    def test_rental_advance_is_not_a_refundable_security_deposit(self):
        database = FakeOdoo()
        database.products[0].update(default_code="LOC-ADVANCE", display_name="Rental deposit")
        database.lines[0]["is_downpayment"] = True
        self.assertEqual(self.get_report(database=database)["summary"]["revenue"], 500)

    def test_native_advance_flag_wins_even_if_its_product_reference_starts_dep(self):
        database = FakeOdoo()
        database.orders[0]["amount_total"] += 50
        database.products.append(dict(id=34, default_code="DEP-ADVANCE", categ_id=[25, "Advances"]))
        database.lines.append(dict(id=10, order_id=[1, "S001"], product_id=[34, "Advance"],
                                   price_total=50, is_downpayment=True))
        report = self.get_report(database=database)
        self.assertEqual(report["summary"]["revenue"], 550)
        self.assertEqual({row["name"]: row["revenue"] for row in report["product_categories"]}["Advances"], 50)

    def test_reversed_cancelled_missing_or_foreign_retention_never_becomes_income(self):
        for change in ('reversed', 'draft', 'cancel', 'missing', 'foreign', 'amount_changed'):
            with self.subTest(change=change):
                database = self.deposit_database(125)
                if change == 'reversed':
                    database.retention_moves.append(dict(id=102, state='posted', move_type='entry',
                                                         company_id=[1, 'Agency'], reversed_entry_id=[101, 'Retention']))
                elif change == 'missing':
                    database.retention_moves.clear()
                elif change == 'foreign':
                    database.retention_moves[0]['company_id'] = [2, 'Other agency']
                elif change == 'amount_changed':
                    database.retention_moves[0]['amount_total_signed'] = 75
                else:
                    database.retention_moves[0]['state'] = change
                report = self.get_report(database=database)
                self.assertEqual(report['summary']['revenue'], 500)
                self.assertNotIn('Damage compensation', {item['name'] for item in report['product_categories']})

    def test_retained_total_without_native_events_does_not_become_income(self):
        database = self.deposit_database(125)
        database.orders[0]['note'] = write_metadata(database.orders[0]['note'], 'security_deposit',
                                                   {'retained_amount': 125})
        self.assertEqual(self.get_report(database=database)['summary']['revenue'], 500)

    def test_previous_period_uses_native_retention_evidence_too(self):
        database = self.deposit_database(125)
        database.orders[4]['note'] = write_metadata(database.orders[4]['note'], 'security_deposit',
                                                   {'retained_amount': 50, 'events': [
                                                       {'action': 'retain', 'move_id': 103, 'amount': 50}]})
        database.retention_moves.append(dict(id=103, state='posted', move_type='entry', company_id=[1, 'Agency'],
                                             amount_total_signed=50))
        report = self.get_report(database=database)
        self.assertEqual(report['comparison']['revenue_change'], 316.7)
        database.retention_moves.append(dict(id=104, state='posted', move_type='entry', company_id=[1, 'Agency'],
                                             reversed_entry_id=[103, 'Old retention']))
        self.assertEqual(self.get_report(database=database)['comparison']['revenue_change'], 525)

    def test_native_retention_is_counted_once_and_capped_by_saved_total(self):
        database = self.deposit_database(125)
        database.orders[0]['note'] = write_metadata(database.orders[0]['note'], 'security_deposit',
                                                   {'retained_amount': 80, 'events': [
                                                       {'action': 'retain', 'move_id': 101, 'amount': 125},
                                                       {'action': 'retain', 'move_id': 101, 'amount': 125}]})
        self.assertEqual(self.get_report(database=database)['summary']['revenue'], 580)

    def test_vehicle_cash_totals_include_native_deposit_refunds_without_sale_lines(self):
        database = self.deposit_database()
        database.orders[0]['note'] = write_metadata(database.orders[0]['note'], 'security_deposit',
                                                   {'retained_amount': 0, 'events': [
                                                       {'action': 'refund', 'credit_note_id': 201, 'amount': 40},
                                                       {'action': 'refund', 'credit_note_id': 202, 'amount': 70}]})
        database.invoices.extend([
            dict(id=201, company_id=[1, 'Agency'], amount_total=40, amount_residual=0, move_type='out_refund'),
            dict(id=202, company_id=[2, 'Other'], amount_total=70, amount_residual=0, move_type='out_refund'),
            dict(id=203, company_id=[1, 'Agency'], amount_total=90, amount_residual=0, move_type='out_refund'),
        ])
        report = self.get_report(7, database)
        self.assertEqual(report['summary']['revenue'], 200)
        self.assertEqual(report['summary']['invoiced'], 70)
        self.assertEqual(report['summary']['collected'], 50)
        self.assertEqual(report['summary']['outstanding'], 20)


if __name__ == "__main__":
    unittest.main()
