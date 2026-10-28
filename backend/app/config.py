from dotenv import load_dotenv
import os
from urllib.parse import urlparse

load_dotenv()

def get_cors_allowed_origins() -> list[str]:
    raw_origins = os.getenv("CORS_ALLOWED_ORIGINS", "")
    origins = [
        origin.strip().rstrip("/")
        for origin in raw_origins.split(",")
        if origin.strip()
    ]

    if not origins:
        raise RuntimeError(
            "CORS_ALLOWED_ORIGINS is required and must contain at least one origin."
        )

    for origin in origins:
        parsed = urlparse(origin)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise RuntimeError(
                f"Invalid CORS origin {origin!r}; use a complete http(s) origin."
            )

    return origins
