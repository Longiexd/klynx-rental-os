from unittest.mock import patch

from app.routes import search


def test_search_returns_native_destinations_and_never_writes():
    calls = []
    def execute(model, method, args=None, kwargs=None):
        calls.append((model, method, args, kwargs))
        if model == "sale.order":
            if "invoice_ids" in kwargs["fields"]:
                return [{"id": 33, "name": "S00033", "invoice_ids": [50]}]
            if "note" in kwargs["fields"]:
                return [{"id": 33, "name": "S00033", "opportunity_id": [36, "QA"],
                         "note": "[Rental OS fleet.vehicle:15]"}]
            return [{"id": 33, "name": "S00033", "partner_id": [32, "QA"]}]
        if model == "fleet.vehicle":
            return [{"id": 15, "name": "QA vehicle", "license_plate": "QA-15"}]
        if model == "res.partner":
            return [{"id": 32, "name": "QA"}, {"id": 99, "name": "Unlinked contact"}]
        if model == "crm.lead":
            return [{"id": 36, "name": "QA", "partner_id": [32, "QA"], "stage_id": [2, "Devis envoyé"]}]
        if model == "account.move":
            return [{"id": 50, "name": "INV/QA", "invoice_origin": "S00033"},
                    {"id": 51, "name": "Unrelated invoice"}]
        if model == "mail.activity":
            return [{"id": 60, "res_model": "sale.order", "res_id": 33, "res_name": "S00033", "summary": "QA call"}]
        raise AssertionError(model)
    with patch.object(search.odoo, "execute", side_effect=execute):
        results = search.search("QA")["results"]
    by_kind = {row["kind"]: row for row in results}
    assert set(by_kind) == {"Rental", "Vehicle", "Customer", "Prospect", "Invoice", "Activity"}
    assert by_kind["Prospect"]["href"] == by_kind["Rental"]["href"] == "/dashboard/rentals/33"
    assert by_kind["Vehicle"]["href"] == "/dashboard/fleet?vehicle=15"
    assert by_kind["Invoice"]["href"] == "/dashboard/rentals/33#payments"
    assert by_kind["Activity"]["href"] == "/dashboard/rentals/33?activity=60"
    assert not any(row["id"] in {"customer-99", "invoice-51"} for row in results)
    assert all(method == "search_read" for _, method, *_ in calls)
    assert all("sudo" not in str(kwargs) for *_, kwargs in calls)


def test_blank_query_makes_no_odoo_requests_and_company_data_is_not_cached():
    with patch.object(search.odoo, "execute", return_value=[]) as rpc:
        assert search.search("  ") == {"results": []}
        rpc.assert_not_called()
        search.search("same query")
        first = rpc.call_count
        search.search("same query")
        assert rpc.call_count == first * 2


def test_search_route_requires_the_existing_company_session(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:3100")
    from app.main import app
    # FastAPI preserves included routers lazily on recent versions.
    from app.auth import require_session
    included = next(route for route in app.routes if getattr(route, "original_router", None) is search.router)
    assert any(dependency.dependency is require_session for dependency in included.include_context.dependencies)
