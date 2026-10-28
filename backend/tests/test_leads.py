import unittest
from unittest.mock import patch
from fastapi import HTTPException
from app.routes import leads


class LeadTests(unittest.TestCase):
    def test_saved_demand_reuses_linked_prospect_and_keeps_existing_notes(self):
        data = leads.LeadCreate(name="Client", partner_id=2, opportunity_id=20, reservation_start="2026-09-20")
        with patch.object(leads.odoo, "execute", side_effect=[
            [{"id": 2, "name": "Client"}], [{"partner_id": [2, "Client"], "description": "Original notes"}], True,
        ]) as rpc:
            self.assertEqual(leads.create_lead(data)["lead_id"], 20)
        self.assertEqual(rpc.call_args.args[1], "write")
        self.assertIn("Original notes", rpc.call_args.args[2][1]["description"])
        self.assertIn("2026-09-20", rpc.call_args.args[2][1]["description"])
        self.assertFalse(any(call.args[1] == "create" for call in rpc.call_args_list))

    def test_another_customers_prospect_is_not_overwritten(self):
        with patch.object(leads.odoo, "execute", side_effect=[
            [{"id": 2, "name": "Client"}], [{"partner_id": [3, "Other"], "description": "Keep"}],
        ]) as rpc, self.assertRaises(HTTPException):
            leads.create_lead(leads.LeadCreate(name="Client", partner_id=2, opportunity_id=20))
        self.assertEqual(rpc.call_count, 2)
