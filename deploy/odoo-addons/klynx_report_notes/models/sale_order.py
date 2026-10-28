from markupsafe import Markup
from odoo import models
from odoo.tools import html_sanitize

from ..note_filter import customer_note


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def _klynx_customer_note(self):
        self.ensure_one()
        return Markup(html_sanitize(customer_note(self.note)))
