from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.odoo_client import OdooClient, safe_odoo_message
from app.routes import booking_changes


def test_renewed_session_cookie_does_not_hide_odoo_business_error():
    client = OdooClient({'endpoint': 'http://localhost:8069'}, sid='restored-session')
    client.http.cookies.set('session_id', 'renewed-session', domain='localhost.local', path='/')
    response = MagicMock(status_code=200)
    response.json.return_value = {'error': {'data': {'name': 'odoo.exceptions.UserError',
        'message': 'Nothing to invoice. restored-session renewed-session'}}}
    with patch.object(client.http, 'post', return_value=response), pytest.raises(HTTPException) as failure:
        client.rpc('/web/dataset/call_kw', {})
    assert failure.value.status_code == 422
    assert failure.value.detail == 'Nothing to invoice. [redacted] [redacted]'
    client.close()


@pytest.mark.parametrize("name,status", [("UserError", 422), ("ValidationError", 422), ("AccessError", 403),
                                        ("AccessDenied", 401), ("SessionExpiredException", 401), ("DatabaseError", 502)])
@pytest.mark.parametrize("field", ["message", "arguments"])
def test_business_error_status_and_safe_message(name, status, field):
    client = OdooClient({"endpoint": "http://localhost:8069"})
    payload = {"name": "odoo.exceptions." + name, field: "Nothing to invoice." if field == "message" else ["Nothing to invoice."]}
    response = MagicMock(status_code=200)
    response.json.return_value = {"error": {"data": payload}}
    with patch.object(client.http, "post", return_value=response), pytest.raises(HTTPException) as failure:
        client.rpc("/web/dataset/call_kw", {})
    assert failure.value.status_code == status
    assert (failure.value.detail == "Nothing to invoice.") == (status in {422, 403})
    client.close()


def test_diagnostics_never_reach_message():
    message = "Wrong company journal.\npassword=hunter2 token=abc\nSELECT password FROM users\nTraceback (most recent call last):\nFile '/opt/private/server.py'\nhttp://private.internal:8069"
    assert safe_odoo_message({"message": message, "debug": "private traceback"}) == "Wrong company journal."
    assert safe_odoo_message({"arguments": ["Invoice not posted."]}) == "Invoice not posted."
    assert len(safe_odoo_message({"message": "x " * 500})) == 300


@pytest.mark.parametrize('diagnostic', ['SELECT *\nFROM users', 'password:\nhidden value', 'Authorization: Bearer\nhidden value'])
def test_multiline_diagnostic_values_are_discarded(diagnostic):
    assert safe_odoo_message({'message': 'Invoice not posted.\n' + diagnostic}) == 'Invoice not posted.'


def test_registered_single_label_hostname_is_not_exposed():
    client = OdooClient({'endpoint': 'http://privatehost:8069', 'database_name': 'private_database'})
    response = MagicMock(status_code=200)
    response.json.return_value = {'error': {'data': {'name': 'odoo.exceptions.UserError', 'message': 'Invoice not posted on privatehost in private_database.'}}}
    with patch.object(client.http, 'post', return_value=response), pytest.raises(HTTPException) as failure:
        client.rpc('/web/dataset/call_kw', {})
    assert 'privatehost' not in failure.value.detail and 'private_database' not in failure.value.detail
    client.close()


@pytest.mark.parametrize("message", ["password: hunter2", "token abcdef", "SELECT secret FROM users", "Traceback private"])
def test_fully_unsafe_message_uses_generic_fallback(message):
    assert safe_odoo_message({"message": message}) == safe_odoo_message({})


def test_hosts_paths_and_opaque_values_are_redacted():
    message = "Invoice not posted on http://private.internal:8069 at /opt/odoo/app.py C:\\private\\app.py klynx-ci-odoo 192.0.2.123 abcdefghijklmnopqrstuvwxyz123456789"
    safe = safe_odoo_message({"message": message})
    assert safe.startswith("Invoice not posted")
    assert all(value not in safe for value in ("private", "odoo", "192.0.2", "abcdefghijkl"))


def test_cancel_preserves_safe_http_error():
    error = HTTPException(422, "Invoice not posted.")
    with patch.object(booking_changes, "get_record", return_value={"state": "sale"}), \
         patch.object(booking_changes.odoo, "execute", side_effect=error), pytest.raises(HTTPException) as failure:
        booking_changes.cancel_booking(4)
    assert failure.value is error


def test_cancel_lead_failure_is_safe_logged_and_truthful(caplog):
    with patch.object(booking_changes, "get_record", return_value={"state": "sale", "opportunity_id": [7, "Lead"]}), \
         patch.object(booking_changes.odoo, "execute", side_effect=[True, RuntimeError("password=hidden")]), \
         patch.object(booking_changes, "refresh_fleet"):
        result = booking_changes.cancel_booking(4)
    assert result["lead_marked_lost"] is False
    assert "could not be marked lost" in caplog.text and "hidden" not in caplog.text


def test_unexpected_cancellation_error_does_not_echo_exception(caplog):
    with patch.object(booking_changes, "get_record", return_value={"state": "sale"}), \
         patch.object(booking_changes.odoo, "execute", side_effect=RuntimeError("password=hidden")), pytest.raises(HTTPException) as failure:
        booking_changes.cancel_booking(4)
    assert failure.value.status_code == 502
    assert "hidden" not in failure.value.detail + caplog.text
