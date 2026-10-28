"""Owner-managed entitlements. Business records and manual holds remain in Odoo."""
from fastapi import HTTPException
from app.odoo_client import current_client

KEYS = ("fleet_care", "fleet_compliance", "automatic_reminders", "analytics")
PLANS = {
    "starter": dict.fromkeys(KEYS, False),
    "premium": dict.fromkeys(KEYS, True),
    "enterprise": dict.fromkeys(KEYS, True),
}


def resolve(plan, overrides=None):
    if plan not in PLANS:
        raise ValueError("Unknown plan")
    overrides = overrides or {}
    if not isinstance(overrides, dict) or any(k not in KEYS or type(v) is not bool for k, v in overrides.items()):
        raise ValueError("Unknown feature or invalid switch")
    result = {**PLANS[plan], **overrides}
    # Evidence enforcement depends on the customer's Fleet care layer.
    result["fleet_compliance"] = result["fleet_care"] and result["fleet_compliance"]
    return result


def enabled(feature):
    client = current_client.get()
    # Existing callers/tests without a tenant keep the established behavior.
    return client is None or client.profile.get("features", PLANS["premium"])[feature]


def check_path(path, features):
    path = path.rstrip("/")
    feature = None
    if path == "/analytics" or path.startswith("/analytics/"):
        feature = "analytics"
    elif path.startswith("/cars/") and (path == "/cars/care" or path.endswith(("/maintenance-plan", "/contracts/link")) or "/services/" in path or "/documents" in path):
        feature = "fleet_care"
    if feature and not features[feature]:
        raise HTTPException(403, "This feature is disabled for your company")
