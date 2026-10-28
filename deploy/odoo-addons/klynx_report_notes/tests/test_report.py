from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestCustomerQuotationNote(TransactionCase):
    def test_native_report_preserves_customer_terms_and_stored_state(self):
        partner = self.env['res.partner'].create({'name': 'CI quotation privacy customer'})
        order = self.env['sale.order'].create({'partner_id': partner.id, 'note':
            '<p>Customer payment terms / Conditions générales</p>'
            '<p>[Rental OS fleet.vehicle:42]</p><p>[Rental OS booking:quotation]</p>'
            '<p>[Klynx metadata:rental_logistics:YWJjZA==]</p>'})
        original = order.note
        rendered, _ = self.env['ir.actions.report']._render_qweb_html('sale.report_saleorder', [order.id])
        text = rendered.decode()
        self.assertIn('Customer payment terms / Conditions générales', text)
        self.assertNotIn('[Rental OS', text)
        self.assertNotIn('[Klynx metadata:', text)
        self.assertEqual(order.note, original)
