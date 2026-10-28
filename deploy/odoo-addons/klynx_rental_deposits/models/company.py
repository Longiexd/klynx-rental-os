from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    klynx_deposit_liability_account_id = fields.Many2one(
        'account.account', string='Security deposit liability', check_company=True,
        domain="[('account_type', '=', 'liability_current'), ('reconcile', '=', True)]",
        help='Refundable security deposits are held here until refunded or retained for damage.')
    klynx_deposit_income_account_id = fields.Many2one(
        'account.account', string='Damage compensation income', check_company=True,
        domain="[('account_type', '=', 'income')]",
        help='Only explicitly retained damage compensation is transferred to this income account.')
    klynx_deposit_journal_id = fields.Many2one(
        'account.journal', string='Deposit adjustment journal', check_company=True,
        domain="[('type', '=', 'general')]",
        help='General journal used to recognize deposit amounts retained for damage.')


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    klynx_deposit_liability_account_id = fields.Many2one(
        related='company_id.klynx_deposit_liability_account_id', readonly=False)
    klynx_deposit_income_account_id = fields.Many2one(
        related='company_id.klynx_deposit_income_account_id', readonly=False)
    klynx_deposit_journal_id = fields.Many2one(
        related='company_id.klynx_deposit_journal_id', readonly=False)
