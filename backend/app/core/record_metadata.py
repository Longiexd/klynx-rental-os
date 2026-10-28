"""Bounded structured records stored alongside existing Odoo note links."""
import base64
import binascii
import json
import re


def _pattern(key: str):
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,40}", key):
        raise ValueError("Invalid metadata key")
    return re.compile(r"\[Klynx metadata:" + key + r":([A-Za-z0-9_=-]+)\]")


def read_metadata(note: str | None, key: str) -> dict | None:
    matches = _pattern(key).findall(note or "")
    if len(matches) != 1 or len(matches[0]) > 100000:
        return None
    try:
        value = json.loads(base64.b64decode(matches[0], altchars=b"-_", validate=True))
        return value if isinstance(value, dict) else None
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return None


def write_metadata(note: str | None, key: str, value: dict) -> str:
    pattern = _pattern(key)
    payload = base64.urlsafe_b64encode(json.dumps(
        value, ensure_ascii=False, allow_nan=False, separators=(",", ":"),
    ).encode()).decode()
    if len(payload) > 100000:
        raise ValueError("Metadata record is too large")
    remaining = pattern.sub("", note or "").rstrip()
    return f"{remaining}\n[Klynx metadata:{key}:{payload}]".strip()
