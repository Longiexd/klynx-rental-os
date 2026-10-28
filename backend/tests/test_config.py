import pytest

from app.config import get_cors_allowed_origins


def test_cors_origins_are_environment_driven(monkeypatch):
    monkeypatch.setenv(
        "CORS_ALLOWED_ORIGINS",
        "https://staging.rental-os.example.invalid/, https://rental-os.example.invalid",
    )

    assert get_cors_allowed_origins() == [
        "https://staging.rental-os.example.invalid",
        "https://rental-os.example.invalid",
    ]


def test_cors_origins_are_required(monkeypatch):
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)

    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS is required"):
        get_cors_allowed_origins()


@pytest.mark.parametrize(
    "origin",
    ["*", "staging.rental-os.example.invalid", "ftp://staging.rental-os.example.invalid"],
)
def test_cors_origins_reject_unsafe_or_incomplete_values(monkeypatch, origin):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", origin)

    with pytest.raises(RuntimeError, match="Invalid CORS origin"):
        get_cors_allowed_origins()
