"""Run inside a disposable Odoo 18 Community database with a chart of accounts."""
from unittest.mock import patch
from uuid import uuid4

from odoo import Command
from odoo.addons.account.tests.common import AccountTestInvoicingCommon
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import new_test_user, tagged

from ..models.sale_order import CHECKS, _write_metadata


@tagged('post_install', '-at_install')
class TestRentalDeposits(AccountTestInvoicingCommon):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.liability = cls.env['account.account'].create({
            'name': 'CI refundable rental deposits', 'code': 'KLYNXDEP',
            'account_type': 'liability_current', 'reconcile': True,
            'company_ids': [Command.set(cls.env.company.ids)],
        })
        cls.income = cls.company_data['default_account_revenue']
        cls.journal = cls.company_data['default_journal_bank']
        cls.env.company.write({
            'klynx_deposit_liability_account_id': cls.liability.id,
            'klynx_deposit_income_account_id': cls.income.id,
            'klynx_deposit_journal_id': cls.company_data['default_journal_misc'].id,
        })
        cls.deposit_product = cls.env['product.product'].create({
            'name': 'CI rental security deposit', 'default_code': 'DEP-CI',
            'type': 'service', 'invoice_policy': 'order', 'list_price': 500,
            'property_account_income_id': cls.income.id, 'taxes_id': [Command.clear()],
        })
        cls.rental_product = cls.env['product.product'].create({
            'name': 'CI rental days', 'default_code': 'LOC-CI',
            'type': 'service', 'invoice_policy': 'order', 'list_price': 100,
            'property_account_income_id': cls.income.id, 'taxes_id': [Command.clear()],
        })

    def booking(self, paid=True, damaged=False, approved=True):
        record = dict(status='completed', inspection={key: True for key in CHECKS},
                      damaged=damaged, damage_notes='Door scratch' if damaged else '')
        record['inspection']['approved'] = approved
        order = self.env['sale.order'].create({
            'partner_id': self.partner_a.id,
            'note': _write_metadata('Client terms\n[Rental OS returned]', 'rental_return', record),
            'order_line': [
                Command.create({'product_id': self.rental_product.id, 'product_uom_qty': 1, 'price_unit': 100}),
                Command.create({'product_id': self.deposit_product.id, 'product_uom_qty': 1, 'price_unit': 500}),
            ],
        })
        order.action_confirm()
        invoice = order._create_invoices()
        invoice.action_post()
        if paid:
            self.env['account.payment.register'].with_context(
                active_model='account.move', active_ids=invoice.ids).create({
                    'journal_id': self.journal.id, 'amount': 600,
                    'payment_method_line_id': self.inbound_payment_method_line.id,
                })._create_payments()
        return order, invoice

    def settlement(self, action='refund', amount=500, **changes):
        return dict(request_id=str(uuid4()), action=action, amount=amount,
                    journal_id=self.journal.id, note='CI deposit settlement', **changes)

    def test_deposit_is_liability_and_refund_has_native_payment(self):
        order, invoice = self.booking()
        deposit_line = invoice.invoice_line_ids.filtered(lambda line: line.product_id == self.deposit_product)
        self.assertEqual(deposit_line.account_id, self.liability)
        self.assertEqual(deposit_line.balance, -500)
        self.assertEqual(order.klynx_deposit_snapshot()['held_amount'], 500)
        result = order.klynx_deposit_settle(self.settlement())
        credit = self.env['account.move'].browse(result['event']['credit_note_id'])
        payment = self.env['account.payment'].browse(result['event']['payment_ids'])
        self.assertEqual(credit.move_type, 'out_refund')
        self.assertEqual(credit.state, 'posted')
        self.assertEqual(credit.amount_total, 500)
        self.assertEqual(credit.amount_residual, 0)
        self.assertEqual(credit.reversed_entry_id, invoice)
        self.assertEqual(payment.payment_type, 'outbound')
        self.assertEqual(payment.amount, 500)
        self.assertEqual(result['deposit']['held_amount'], 0)
        self.assertEqual(result['deposit']['retained_amount'], 0)
        self.assertTrue(deposit_line.reconciled)
        self.assertIn('Client terms', order.note)
        self.assertIn('[Rental OS returned]', order.note)

    def test_request_retry_never_duplicates_refund_and_changed_retry_fails(self):
        order, _invoice = self.booking()
        request = self.settlement()
        result = order.klynx_deposit_settle(request)
        count = self.env['account.payment'].search_count([])
        repeat = order.klynx_deposit_settle(request)
        self.assertTrue(repeat['already'])
        self.assertEqual(repeat['event'], result['event'])
        self.assertEqual(self.env['account.payment'].search_count([]), count)
        with self.assertRaises(UserError):
            order.klynx_deposit_settle({**request, 'amount': 400})

    def test_unreconciled_refund_is_not_accepted_from_stale_payment_links(self):
        order, _invoice = self.booking()
        request = self.settlement()
        result = order.klynx_deposit_settle(request)
        credit = self.env['account.move'].browse(result['event']['credit_note_id'])
        payment = self.env['account.payment'].browse(result['event']['payment_ids'])
        credit.line_ids.filtered(
            lambda line: line.account_id.account_type == 'asset_receivable').remove_move_reconcile()
        self.assertEqual(credit.state, 'posted')
        self.assertEqual(payment.move_id.state, 'posted')
        self.assertEqual(credit.amount_residual, 500)
        with self.assertRaises(UserError):
            order.klynx_deposit_snapshot()
        with self.assertRaises(UserError):
            order.klynx_deposit_settle(request)

    def test_credit_paid_by_different_payment_does_not_validate_original_refund(self):
        order, _invoice = self.booking()
        result = order.klynx_deposit_settle(self.settlement())
        credit = self.env['account.move'].browse(result['event']['credit_note_id'])
        credit.line_ids.filtered(
            lambda line: line.account_id.account_type == 'asset_receivable').remove_move_reconcile()
        self.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=credit.ids).create({
                'journal_id': self.journal.id, 'amount': 500,
                'payment_method_line_id': self.outbound_payment_method_line.id,
            })._create_payments()
        self.assertEqual(credit.amount_residual, 0)
        with self.assertRaises(UserError):
            order.klynx_deposit_snapshot()

    def test_damage_retention_recognizes_only_retained_amount_and_refunds_remainder(self):
        order, invoice = self.booking(damaged=True, approved=False)
        result = order.klynx_deposit_settle(self.settlement('retain', 120))
        move = self.env['account.move'].browse(result['event']['move_id'])
        self.assertEqual(move.state, 'posted')
        self.assertEqual(move.line_ids.filtered(lambda line: line.account_id == self.liability).balance, 120)
        self.assertEqual(move.line_ids.filtered(lambda line: line.account_id == self.income).balance, -120)
        self.assertEqual(result['deposit']['held_amount'], 380)
        refunded = order.klynx_deposit_settle(self.settlement('refund', 380))
        self.assertEqual(refunded['deposit']['held_amount'], 0)
        self.assertEqual(refunded['deposit']['retained_amount'], 120)
        self.assertEqual(refunded['deposit']['refunded_amount'], 380)
        self.assertTrue(invoice.invoice_line_ids.filtered(
            lambda line: line.product_id == self.deposit_product).reconciled)

    def test_reversed_retention_is_not_counted_as_valid_compensation(self):
        order, _invoice = self.booking(damaged=True, approved=False)
        result = order.klynx_deposit_settle(self.settlement('retain', 120))
        retained = self.env['account.move'].browse(result['event']['move_id'])
        reversal = retained._reverse_moves()
        reversal.action_post()
        self.assertEqual(retained.state, 'posted')
        self.assertEqual(reversal.reversed_entry_id, retained)
        with self.assertRaises(UserError):
            order.klynx_deposit_snapshot()
        with self.assertRaises(UserError):
            order.klynx_deposit_settle(self.settlement('refund', 380))

    def test_changed_liability_or_income_configuration_blocks_existing_history(self):
        order, _invoice = self.booking(damaged=True, approved=False)
        order.klynx_deposit_settle(self.settlement('retain', 120))
        other_income = self.copy_account(self.income)
        self.env.company.klynx_deposit_income_account_id = other_income
        with self.assertRaises(UserError):
            order.klynx_deposit_snapshot()
        self.env.company.klynx_deposit_income_account_id = self.income
        other_liability = self.copy_account(self.liability)
        self.env.company.klynx_deposit_liability_account_id = other_liability
        with self.assertRaises(UserError):
            order.klynx_deposit_snapshot()

    def test_incomplete_check_damage_and_unpaid_invoice_block_refund(self):
        order, _invoice = self.booking(approved=False)
        with self.assertRaises(UserError):
            order.klynx_deposit_settle(self.settlement())
        damaged, _invoice = self.booking(damaged=True, approved=False)
        with self.assertRaises(UserError):
            damaged.klynx_deposit_settle(self.settlement())
        unpaid, _invoice = self.booking(paid=False)
        self.assertIn('Fully pay', unpaid.klynx_deposit_snapshot()['legacy_issue'])
        with self.assertRaises(UserError):
            unpaid.klynx_deposit_settle(self.settlement())

    def test_bad_amount_and_excess_settlement_leave_accounting_untouched(self):
        order, _invoice = self.booking()
        count = self.env['account.move'].search_count([])
        for amount in (True, -1, 0, float('nan'), float('inf'), 500.001, 501):
            with self.subTest(amount=amount), self.assertRaises(UserError):
                order.klynx_deposit_settle(self.settlement(amount=amount))
        self.assertEqual(self.env['account.move'].search_count([]), count)
        self.assertEqual(order.klynx_deposit_snapshot()['held_amount'], 500)

    def test_failure_after_credit_creation_rolls_back_everything(self):
        order, _invoice = self.booking()
        before = order.note
        count = self.env['account.move'].search_count([])
        native = type(order)._klynx_refund

        def interrupted(record, amount, journal_id, note):
            native(record, amount, journal_id, note)
            raise UserError('CI interruption after native payment')

        with patch.object(type(order), '_klynx_refund', interrupted), self.assertRaises(UserError):
            order.klynx_deposit_settle(self.settlement())
        self.assertEqual(self.env['account.move'].search_count([]), count)
        self.assertEqual(order.note, before)
        self.assertEqual(order.klynx_deposit_snapshot()['held_amount'], 500)

    def test_inspection_is_editable_after_return_and_locked_after_settlement(self):
        order, _invoice = self.booking(approved=False)
        data = {'inspection': {**{key: True for key in CHECKS}, 'approved': True},
                'damaged': False, 'damage_notes': ''}
        result = order.klynx_save_return_inspection(data)
        self.assertTrue(result['inspection']['approved'])
        self.assertIn('inspected_at', result)
        order.klynx_deposit_settle(self.settlement())
        self.assertEqual(order.klynx_save_return_inspection(data), result)
        with self.assertRaises(UserError):
            order.klynx_save_return_inspection({**data, 'inspection': {**data['inspection'], 'approved': False}})

    def test_no_write_access_cannot_settle_or_change_inspection(self):
        order, _invoice = self.booking()
        viewer = new_test_user(self.env, login='ci_deposit_viewer', groups='base.group_user')
        with self.assertRaises(AccessError):
            order.with_user(viewer).klynx_deposit_settle(self.settlement())
        with self.assertRaises(AccessError):
            order.with_user(viewer).klynx_save_return_inspection({})

    def test_deposit_only_invoice_preserves_native_rental_invoicing(self):
        order, invoice = self.booking(paid=False)
        invoice.button_draft()
        invoice.button_cancel()
        result = order.klynx_create_deposit_invoice()
        deposit_invoice = self.env['account.move'].browse(result['invoice_ids'])
        self.assertEqual(deposit_invoice.amount_total, 500)
        self.assertEqual(deposit_invoice.invoice_line_ids.product_id, self.deposit_product)
        repeat = order.klynx_create_deposit_invoice()
        self.assertEqual(repeat['invoice_ids'], deposit_invoice.ids)
        self.assertTrue(repeat['existing_draft'])
        deposit_invoice.action_post()
        rental_invoice = order._create_invoices()
        self.assertEqual(rental_invoice.amount_total, 100)
        self.assertEqual(rental_invoice.invoice_line_ids.product_id, self.rental_product)

    def test_legacy_income_deposit_is_not_refunded_twice_or_silently_migrated(self):
        order, invoice = self.booking(paid=False)
        invoice.button_draft()
        invoice.invoice_line_ids.filtered(lambda line: line.product_id == self.deposit_product).account_id = self.income
        invoice.action_post()
        self.assertIn('legacy deposit', order.klynx_deposit_snapshot()['legacy_issue'])
        count = self.env['account.payment'].search_count([])
        with self.assertRaises(UserError):
            order.klynx_deposit_settle(self.settlement())
        self.assertEqual(self.env['account.payment'].search_count([]), count)

    def test_corrupt_ledger_and_foreign_request_identifier_fail_closed(self):
        order, _invoice = self.booking()
        with self.assertRaises(ValidationError):
            order.klynx_deposit_settle({**self.settlement(), 'request_id': 'not-a-uuid'})
        order.note += '\n[Klynx metadata:security_deposit:!!!]'
        with self.assertRaises(UserError):
            order.klynx_deposit_snapshot()
