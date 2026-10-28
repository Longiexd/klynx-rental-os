from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.control import IDLE_SECONDS
from test_tenancy import control, issue


def test_active_session_reads_avoid_writes_until_touch_interval(control):
    with patch('app.control.time.time', return_value=1000): token = issue(control)
    modes = []
    original = control.db
    @contextmanager
    def observed(write=False):
        modes.append(write)
        with original(write) as connection: yield connection
    with patch.object(control, 'db', observed):
        for now in range(1001, 1060):
            with patch('app.control.time.time', return_value=now): assert control.session(token)['code'] == 'atlas'
        assert modes.count(True) == 0
        with patch('app.control.time.time', return_value=1060): control.session(token)
        assert modes.count(True) == 1


@pytest.mark.parametrize('change', ['disabled', 'revoked', 'suspended'])
def test_recent_touch_never_caches_authorization(control, change):
    token = issue(control)
    control.session(token)
    with control.db(True) as db:
        if change == 'disabled': db.execute("UPDATE users SET active=0 WHERE company='atlas'")
        if change == 'suspended': db.execute("UPDATE companies SET status='suspended' WHERE code='atlas'")
    if change == 'revoked': control.revoke(token)
    with pytest.raises(HTTPException) as failure: control.session(token)
    assert failure.value.status_code == 401


def test_revocation_between_read_and_touch_is_rechecked(control):
    with patch('app.control.time.time', return_value=1000): token = issue(control)
    original = control.db
    @contextmanager
    def revoke_before_write(write=False):
        if write:
            with original(True) as connection: connection.execute('DELETE FROM sessions')
        with original(write) as connection: yield connection
    with patch.object(control, 'db', revoke_before_write), patch('app.control.time.time', return_value=1061), pytest.raises(HTTPException):
        control.session(token)


def test_idle_expiry_is_never_extended_by_throttled_touch(control):
    with patch('app.control.time.time', return_value=1000): token = issue(control)
    with patch('app.control.time.time', return_value=1020): control.session(token)
    with patch('app.control.time.time', return_value=1000 + IDLE_SECONDS), pytest.raises(HTTPException): control.session(token)
