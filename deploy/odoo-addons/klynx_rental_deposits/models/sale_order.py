"""Security deposits use native Community accounting, in one Odoo transaction."""
import base64
import binascii
from datetime import datetime, timezone
import json
import math
import re
from uuid import UUID

from odoo import Command, fields, models, _
from odoo.exceptions import UserError, ValidationError


CHECKS = ('body_checked', 'interior_checked', 'fuel_keys_checked')


def _metadata(note, key):
    marker = '[Klynx metadata:%s:' % key
    matches = re.findall(re.escape(marker) + r'([A-Za-z0-9_=-]+)\]', note or '')
    if marker not in (note or ''):
        return None
    if (note or '').count(marker) != 1 or len(matches) != 1 or len(matches[0]) > 100000:
        raise UserError(_('Saved deposit or return details cannot be read. Review the booking in Odoo.'))
    try:
        value = json.loads(base64.b64decode(matches[0], altchars=b'-_', validate=True))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise UserError(_('Saved deposit or return details cannot be read. Review the booking in Odoo.')) from None
    if not isinstance(value, dict):
        raise UserError(_('Saved deposit or return details cannot be read. Review the booking in Odoo.'))
    return value


def _write_metadata(note, key, value):
    payload = base64.urlsafe_b64encode(json.dumps(
        value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()).decode()
    if len(payload) > 100000:
        raise UserError(_('The saved deposit history is too large. Review the booking in Odoo.'))
    remaining = re.sub(r'\[Klynx metadata:' + re.escape(key) + r':[A-Za-z0-9_=-]+\]', '', note or '').rstrip()
    return '%s\n[Klynx metadata:%s:%s]' % (remaining, key, payload)


def _is_deposit(line):
    return not line.is_downpayment and (line.product_id.default_code or '').strip().upper().startswith('DEP-')


def _condition(data):
    inspection = data.get('inspection')
    damaged = data.get('damaged')
    notes = data.get('damage_notes', '')
    if (not isinstance(inspection, dict) or set(inspection) != set(CHECKS + ('approved',))
            or any(type(value) is not bool for value in inspection.values())
            or type(damaged) is not bool or not isinstance(notes, str) or len(notes) > 4000):
        raise ValidationError(_('Enter the basic return checks and vehicle condition.'))
    notes = notes.strip()
    if damaged and not notes:
        raise ValidationError(_('Describe the vehicle damage before saving.'))
    if inspection['approved'] and (damaged or not all(inspection[key] for key in CHECKS)):
        raise ValidationError(_('Approve the vehicle only after all checks pass without damage.'))
    return {'inspection': inspection, 'damaged': damaged, 'damage_notes': notes}


class SaleOrderLine(models.Model):
    _inherit = 'sale.order.line'

    def _prepare_invoice_line(self, **optional_values):
        values = super()._prepare_invoice_line(**optional_values)
        if _is_deposit(self):
            account = self.order_id._klynx_liability_account()
            if self.tax_id:
                raise UserError(_('Security deposit products must be tax-free. Review DEP- product taxes in Odoo.'))
            values['account_id'] = account.id
        return values


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def _get_invoiceable_lines(self, final=False):
        lines = super()._get_invoiceable_lines(final=final)
        if self.env.context.get('klynx_security_deposit_only'):
            return lines.filtered(lambda line: not line.display_type and _is_deposit(line))
        return lines

    def klynx_create_deposit_invoice(self):
        with self.env.cr.savepoint():
            self._klynx_lock(accounting=True)
            if self.state not in ('sale', 'done'):
                raise UserError(_('Confirm the quotation before invoicing its security deposit.'))
            self._klynx_liability_account()
            deposits = self.order_line.filtered(_is_deposit)
            if not deposits:
                raise UserError(_('This booking has no DEP- security deposit line to invoice.'))
            drafts = self.invoice_ids.filtered(lambda move: move.state == 'draft' and move.move_type == 'out_invoice')
            pure_deposits = drafts.filtered(lambda move: move.invoice_line_ids.filtered(
                lambda line: line.display_type == 'product') and all(
                    line.sale_line_ids and all(_is_deposit(sale_line) and sale_line.order_id == self
                                              for sale_line in line.sale_line_ids)
                    for line in move.invoice_line_ids.filtered(lambda line: line.display_type == 'product')))
            if drafts - pure_deposits:
                raise UserError(_('A mixed draft invoice already exists. Review it in Odoo before invoicing the deposit separately.'))
            if pure_deposits:
                return {'order_id': self.id, 'invoice_ids': pure_deposits.ids, 'existing_draft': True}
            if not any(line.qty_to_invoice > 0 for line in deposits):
                raise UserError(_('The security deposit is already invoiced. Open its existing invoice.'))
            invoices = self.with_context(klynx_security_deposit_only=True)._create_invoices()
            return {'order_id': self.id, 'invoice_ids': invoices.ids, 'existing_draft': False}

    def _klynx_lock(self, accounting=False):
        self.ensure_one()
        self.check_access('write')
        self.env.cr.execute('SELECT id FROM sale_order WHERE id = %s FOR UPDATE', [self.id])
        self.invalidate_recordset(['note', 'state', 'order_line', 'invoice_ids'])
        if accounting:
            self._klynx_lock_accounting()

    def _klynx_lock_accounting(self):
        """Serialize validation with edits to the known native accounting evidence."""
        ledger = _metadata(self.note, 'security_deposit') or {'events': []}
        events = ledger.get('events')
        if not isinstance(events, list):
            raise UserError(_('Saved deposit history cannot be read. Review the booking in Odoo.'))
        move_ids, payment_ids = [], []
        for event in events:
            if (not isinstance(event, dict) or type(event.get('move_id')) is not int
                    or not isinstance(event.get('payment_ids'), list)
                    or any(type(identifier) is not int or identifier <= 0 for identifier in event['payment_ids'])):
                raise UserError(_('Saved deposit accounting references cannot be read. Review the booking in Odoo.'))
            move_ids.append(event['move_id'])
            payment_ids.extend(event['payment_ids'])
        payments = self.env['account.payment'].browse(payment_ids).exists()
        payments.check_access('read')
        payments.flush_recordset()
        self.env.cr.execute('SELECT id FROM account_payment WHERE id = ANY(%s) ORDER BY id FOR UPDATE', [payments.ids])
        moves = self.invoice_ids | self.env['account.move'].browse(move_ids).exists() | payments.move_id
        moves.check_access('read')
        moves.flush_recordset()
        self.env.cr.execute('SELECT id FROM account_move WHERE id = ANY(%s) ORDER BY id FOR UPDATE', [moves.ids])
        lines = moves.line_ids
        lines.flush_recordset()
        self.env.cr.execute('SELECT id FROM account_move_line WHERE id = ANY(%s) ORDER BY id FOR UPDATE', [lines.ids])
        moves.invalidate_recordset()
        lines.invalidate_recordset()
        payments.invalidate_recordset()

    def _klynx_liability_account(self):
        self.ensure_one()
        account = self.company_id.klynx_deposit_liability_account_id
        if (not account or account.account_type != 'liability_current' or not account.reconcile
                or account.deprecated or self.company_id not in account.company_ids):
            raise UserError(_('Configure a reconcilable security deposit liability account in Odoo Invoicing settings.'))
        if account.currency_id and account.currency_id != self.currency_id:
            raise UserError(_('The deposit liability account currency must match the booking currency.'))
        return account

    def _klynx_ledger(self):
        ledger = _metadata(self.note, 'security_deposit') or {
            'refunded_amount': 0.0, 'retained_amount': 0.0, 'events': []}
        if not isinstance(ledger.get('events'), list):
            raise UserError(_('Saved deposit history cannot be read. Review the booking in Odoo.'))
        liability = self._klynx_liability_account() if ledger['events'] else self.env['account.account']
        partner = self.partner_invoice_id.commercial_partner_id
        totals = {'refund': 0.0, 'retain': 0.0}
        seen = set()
        for event in ledger['events']:
            if (not isinstance(event, dict) or event.get('action') not in totals
                    or not isinstance(event.get('request_id'), str) or event['request_id'] in seen
                    or type(event.get('amount')) not in (int, float)
                    or not math.isfinite(event['amount']) or event['amount'] <= 0
                    or type(event.get('move_id')) is not int):
                raise UserError(_('Saved deposit history cannot be read. Review the booking in Odoo.'))
            seen.add(event['request_id'])
            move = self.env['account.move'].browse(event['move_id']).exists()
            if (not move or move.company_id != self.company_id or move.state != 'posted'
                    or move.currency_id != self.currency_id
                    or move.reversal_move_ids.filtered(lambda reversal: reversal.state == 'posted')):
                raise UserError(_('A deposit accounting entry was changed or cancelled. Review the booking in Odoo.'))
            move.check_access('read')
            if event['action'] == 'refund':
                payment_ids = event.get('payment_ids')
                if (not isinstance(payment_ids, list) or not payment_ids
                        or any(type(identifier) is not int or identifier <= 0 for identifier in payment_ids)
                        or len(payment_ids) != len(set(payment_ids))):
                    raise UserError(_('Saved deposit refund references cannot be read. Review the booking in Odoo.'))
                payments = self.env['account.payment'].browse(payment_ids).exists()
                if (move.move_type != 'out_refund'
                        or move.partner_id.commercial_partner_id != partner
                        or event.get('credit_note_id') != move.id
                        or self.currency_id.compare_amounts(move.amount_total, event['amount'])
                        or not self.currency_id.is_zero(move.amount_residual)
                        or move.invoice_line_ids.filtered(lambda line: line.display_type == 'product').account_id != liability
                        or move.invoice_line_ids.tax_ids
                        or len(payments) != len(set(payment_ids))
                        or not payments or any(payment.company_id != self.company_id
                                               or payment.payment_type != 'outbound'
                                               or payment.partner_type != 'customer'
                                               or payment.journal_id.id != event.get('journal_id')
                                               or payment.currency_id != self.currency_id
                                               or payment.partner_id.commercial_partner_id != partner
                                               or not payment.move_id or payment.move_id.state != 'posted'
                                               or payment.move_id.reversal_move_ids.filtered(
                                                   lambda reversal: reversal.state == 'posted')
                                               or payment.state in ('draft', 'canceled', 'rejected') for payment in payments)
                        or self.currency_id.compare_amounts(sum(payments.mapped('amount')), event['amount'])):
                    raise UserError(_('A deposit refund payment was changed or cancelled. Review the booking in Odoo.'))
                payments.check_access('read')
                # Odoo's matched_payment_ids/invoice_ids also retain explicit links
                # after unreconciliation. Validate the actual receivable matches.
                receivable = move.line_ids.filtered(lambda line: line.account_id.account_type == 'asset_receivable')
                partials = receivable.matched_debit_ids | receivable.matched_credit_ids
                for payment in payments:
                    matched = partials.filtered(lambda partial:
                        partial.debit_move_id.move_id == payment.move_id
                        or partial.credit_move_id.move_id == payment.move_id)
                    if self.currency_id.compare_amounts(sum(matched.mapped('amount')), payment.amount):
                        raise UserError(_('A deposit refund was unreconciled or allocated to a different payment. Review it in Odoo.'))
            else:
                income = self.company_id.klynx_deposit_income_account_id
                liability_lines = move.line_ids.filtered(lambda line: line.account_id == liability)
                income_lines = move.line_ids.filtered(lambda line: line.account_id == income)
                if (move.move_type != 'entry' or not income or len(move.line_ids) != 2
                        or self.currency_id.compare_amounts(sum(liability_lines.mapped('balance')), event['amount'])
                        or self.currency_id.compare_amounts(sum(income_lines.mapped('balance')), -event['amount'])
                        or any(line.partner_id.commercial_partner_id != partner for line in move.line_ids)):
                    raise UserError(_('A deposit retention entry or its account configuration was changed. Review the booking in Odoo.'))
            totals[event['action']] += event['amount']
        for key, action in (('refunded_amount', 'refund'), ('retained_amount', 'retain')):
            value = ledger.get(key)
            if (type(value) not in (int, float) or not math.isfinite(value)
                    or self.currency_id.compare_amounts(value, totals[action])):
                raise UserError(_('Saved deposit totals do not match their history. Review the booking in Odoo.'))
        return ledger

    def _klynx_deposit_sources(self):
        """Paid liability lines are evidence; never guess an allocation of a mixed partial payment."""
        lines = self.order_line.filtered(_is_deposit)
        invoices = self.env['account.move.line'].search([
            ('sale_line_ids', 'in', lines.ids), ('move_id.state', '=', 'posted'),
            ('move_id.move_type', 'in', ['out_invoice', 'out_refund']),
        ]) if lines else self.env['account.move.line']
        required = self.currency_id.round(sum(lines.mapped('price_total')))
        if required < 0:
            raise UserError(_('The security deposit amount is invalid. Review the DEP- lines in Odoo.'))
        issue = None
        collected = 0.0
        sources = self.env['account.move']
        if not lines:
            return required, collected, sources, issue
        try:
            account = self._klynx_liability_account()
        except UserError as error:
            return required, collected, sources, str(error)
        for line in invoices:
            invoice = line.move_id
            if (invoice.currency_id != self.currency_id or invoice.company_id != self.company_id
                    or line.sale_line_ids.order_id != self):
                issue = _('Deposit invoice ownership or currency is ambiguous. Review it in Odoo.')
                continue
            if invoice.move_type == 'out_refund':
                issue = _('A previous deposit credit note exists. Reconcile its deposit history in Odoo before settling here.')
                continue
            if line.tax_ids or line.account_id != account:
                issue = _('A legacy deposit was taxed or booked outside the deposit liability account. Have your accountant correct it in Odoo before refunding here.')
                continue
            if invoice.payment_state not in ('paid', 'in_payment') or not self.currency_id.is_zero(invoice.amount_residual):
                issue = _('Fully pay the invoice containing the security deposit before settling it. A mixed partial payment cannot be allocated safely.')
                continue
            collected += line.price_total
            sources |= invoice
        collected = self.currency_id.round(collected)
        own_refunds = [event.get('move_id') for event in
                       (_metadata(self.note, 'security_deposit') or {}).get('events', [])
                       if isinstance(event, dict) and event.get('action') == 'refund']
        if sources and self.env['account.move'].search_count([
                ('reversed_entry_id', 'in', sources.ids), ('state', '=', 'posted'),
                ('id', 'not in', own_refunds)]):
            issue = _('A deposit source invoice has an external credit note. Reconcile its deposit history in Odoo before settling here.')
        if self.currency_id.compare_amounts(collected, required) > 0:
            issue = _('Invoiced deposits exceed the booking deposit. Review duplicate DEP- invoices in Odoo.')
        return required, collected, sources, issue

    def klynx_deposit_snapshot(self):
        self.ensure_one()
        self.check_access('read')
        ledger = self._klynx_ledger()
        required, collected, _sources, issue = self._klynx_deposit_sources()
        held = self.currency_id.round(collected - ledger['refunded_amount'] - ledger['retained_amount'])
        if held < 0:
            issue = _('Deposit settlements exceed the valid collected amount. Review the accounting history in Odoo.')
        return {
            'currency': self.currency_id.name, 'currency_rounding': self.currency_id.rounding,
            'required_amount': required, 'collected_amount': collected,
            'refunded_amount': ledger['refunded_amount'], 'retained_amount': ledger['retained_amount'],
            'held_amount': max(0.0, held), 'legacy_issue': issue, 'events': ledger['events'],
        }

    def klynx_save_return_inspection(self, data):
        with self.env.cr.savepoint():
            self._klynx_lock()
            condition = _condition(data if isinstance(data, dict) else {})
            record = _metadata(self.note, 'rental_return')
            if not record or record.get('status') != 'completed':
                raise UserError(_('Complete this booking return before reviewing its condition.'))
            if self._klynx_ledger()['events'] and any(record.get(key) != value for key, value in condition.items()):
                raise UserError(_('The return inspection is locked after a deposit settlement. Review the accounting history in Odoo.'))
            if any(record.get(key) != value for key, value in condition.items()):
                record.update(condition, inspected_at=datetime.now(timezone.utc).isoformat())
                self.write({'note': _write_metadata(self.note, 'rental_return', record)})
            return record

    def klynx_deposit_settle(self, data):
        with self.env.cr.savepoint():
            self._klynx_lock(accounting=True)
            if not isinstance(data, dict):
                raise ValidationError(_('Enter the deposit settlement details.'))
            try:
                request_id = str(UUID(data.get('request_id', '')))
            except (ValueError, TypeError, AttributeError):
                raise ValidationError(_('A valid deposit request identifier is required.')) from None
            action = data.get('action')
            amount = data.get('amount')
            note = data.get('note', '')
            journal_id = data.get('journal_id') if action == 'refund' else None
            if (action not in ('refund', 'retain') or type(amount) not in (float, int)
                    or not math.isfinite(amount) or amount <= 0 or not isinstance(note, str) or len(note) > 4000
                    or action == 'refund' and (type(journal_id) is not int or journal_id <= 0)):
                raise ValidationError(_('Enter a valid positive deposit amount, note and refund account.'))
            rounded = self.currency_id.round(amount)
            if rounded <= 0 or abs(amount - rounded) > 0.0000001:
                raise ValidationError(_('Use the booking currency precision for the deposit amount.'))
            amount = rounded
            fingerprint = {'action': action, 'amount': amount, 'journal_id': journal_id, 'note': note.strip()}
            ledger = self._klynx_ledger()
            existing = next((event for event in ledger['events'] if event['request_id'] == request_id), None)
            if existing:
                if any(existing.get(key) != value for key, value in fingerprint.items()):
                    raise UserError(_('This deposit request was already saved with different details. Refresh the booking.'))
                return {'event': existing, 'deposit': self.klynx_deposit_snapshot(), 'already': True}
            if self.state not in ('sale', 'done'):
                raise UserError(_('Only a confirmed returned booking can settle a deposit.'))
            record = _metadata(self.note, 'rental_return')
            if not record or record.get('status') != 'completed':
                raise UserError(_('Complete the vehicle return before settling the deposit.'))
            condition = _condition(record)
            inspection = condition['inspection']
            if not all(inspection[key] for key in CHECKS):
                raise UserError(_('Complete all basic vehicle checks before settling the deposit.'))
            approved_refund = inspection['approved'] and not condition['damaged']
            damage_settled = condition['damaged'] and condition['damage_notes'] and ledger['retained_amount'] > 0
            if action == 'refund' and not (approved_refund or damage_settled):
                raise UserError(_('Approve the vehicle condition without damage before refunding its deposit.'))
            if action == 'retain' and (not condition['damaged'] or not condition['damage_notes'] or not fingerprint['note']):
                raise UserError(_('Flag the vehicle damage and describe the reason for retaining the deposit.'))
            snapshot = self.klynx_deposit_snapshot()
            if snapshot['legacy_issue']:
                raise UserError(snapshot['legacy_issue'])
            if self.currency_id.compare_amounts(amount, snapshot['held_amount']) > 0:
                raise UserError(_('The settlement exceeds the deposit still held for this booking.'))
            if self.currency_id != self.company_id.currency_id:
                raise UserError(_('Settle foreign-currency deposits in Odoo Accounting after reviewing the exchange rate.'))
            if action == 'refund':
                move, payments = self._klynx_refund(amount, journal_id, fingerprint['note'])
            else:
                move, payments = self._klynx_retain(amount, fingerprint['note']), self.env['account.payment']
            event = dict(fingerprint, request_id=request_id, move_id=move.id,
                         payment_ids=payments.ids, settled_at=datetime.now(timezone.utc).isoformat(),
                         settled_by=self.env.uid)
            if action == 'refund':
                event['credit_note_id'] = move.id
            ledger['events'].append(event)
            key = 'refunded_amount' if action == 'refund' else 'retained_amount'
            ledger[key] = self.currency_id.round(ledger[key] + amount)
            self.write({'note': _write_metadata(self.note, 'security_deposit', ledger)})
            if self.currency_id.is_zero(snapshot['held_amount'] - amount):
                self._klynx_reconcile_liability(ledger)
            return {'event': event, 'deposit': self.klynx_deposit_snapshot(), 'already': False}

    def _klynx_reconcile_liability(self, ledger):
        account = self._klynx_liability_account()
        source_lines = self.env['account.move.line'].search([
            ('sale_line_ids', 'in', self.order_line.filtered(_is_deposit).ids),
            ('move_id.state', '=', 'posted'), ('move_id.move_type', '=', 'out_invoice'),
            ('account_id', '=', account.id),
        ])
        settlement_lines = self.env['account.move'].browse(
            [event['move_id'] for event in ledger['events']]).line_ids.filtered(
                lambda line: line.account_id == account)
        (source_lines + settlement_lines).filtered(lambda line: not line.reconciled).reconcile()

    def _klynx_refund(self, amount, journal_id, note):
        account = self._klynx_liability_account()
        journal = self.env['account.journal'].browse(journal_id).exists()
        if not journal or journal.company_id != self.company_id or journal.type not in ('bank', 'cash'):
            raise UserError(_('Choose a bank or cash journal belonging to this booking company.'))
        journal.check_access('read')
        method = journal.outbound_payment_method_line_ids.filtered(lambda line: line.code == 'manual')[:1]
        if not method or not method.payment_account_id:
            raise UserError(_('Configure a manual outbound payment method and its outstanding payment account on the refund journal in Odoo.'))
        if journal.currency_id and journal.currency_id != self.currency_id:
            raise UserError(_('Choose a refund journal in the booking currency.'))
        _required, _collected, sources, _issue = self._klynx_deposit_sources()
        # Credit only the liability, never rental lines, quantities or taxes.
        values = {
            'move_type': 'out_refund', 'company_id': self.company_id.id,
            'partner_id': self.partner_invoice_id.id, 'currency_id': self.currency_id.id,
            'journal_id': sources[:1].journal_id.id, 'invoice_date': fields.Date.context_today(self),
            'invoice_payment_term_id': False, 'invoice_date_due': fields.Date.context_today(self),
            'invoice_origin': self.name, 'ref': 'Klynx security deposit refund: %s' % self.name,
            'invoice_line_ids': [Command.create({
                'name': note or _('Security deposit refund'), 'quantity': 1, 'price_unit': amount,
                'account_id': account.id, 'tax_ids': [Command.clear()],
            })],
        }
        if len(sources) == 1:
            values['reversed_entry_id'] = sources.id
        move = self.env['account.move'].create(values)
        move.action_post()
        wizard = self.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=move.ids, active_id=move.id).create({
                'amount': amount, 'journal_id': journal.id, 'payment_method_line_id': method.id,
                'payment_date': fields.Date.context_today(self), 'communication': move.ref,
            })
        payments = wizard._create_payments()
        if not payments or not self.currency_id.is_zero(move.amount_residual):
            raise UserError(_('The deposit refund payment was not fully recorded. Review the refund journal configuration.'))
        return move, payments

    def _klynx_retain(self, amount, note):
        account = self._klynx_liability_account()
        income = self.company_id.klynx_deposit_income_account_id
        journal = self.company_id.klynx_deposit_journal_id
        if (not income or income.account_type != 'income' or income.deprecated
                or self.company_id not in income.company_ids
                or not journal or journal.type != 'general' or journal.company_id != self.company_id):
            raise UserError(_('Configure the damage compensation income account and deposit adjustment journal in Odoo Invoicing settings.'))
        partner = self.partner_invoice_id.commercial_partner_id
        move = self.env['account.move'].create({
            'move_type': 'entry', 'company_id': self.company_id.id, 'journal_id': journal.id,
            'date': fields.Date.context_today(self), 'ref': 'Klynx deposit retained: %s' % self.name,
            'line_ids': [
                Command.create({'name': note, 'account_id': account.id, 'partner_id': partner.id,
                                'debit': amount, 'credit': 0}),
                Command.create({'name': note, 'account_id': income.id, 'partner_id': partner.id,
                                'debit': 0, 'credit': amount}),
            ],
        })
        move.action_post()
        return move
