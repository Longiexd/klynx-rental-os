from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_cors_allowed_origins
from app.auth import router as auth_router, require_session
from app.control import Control, Settings
from app.routes import activities, analytics, booking_changes, calendar, cars, crm, customers, invoices, leads, rentals, sales, search

@asynccontextmanager
async def lifespan(app):
    app.state.control = Control(Settings.from_env())
    app.state.control.verify()
    yield


app = FastAPI(
    title="Klynx Rental OS API",
    version="2.0.0",
    lifespan=lifespan,
    docs_url=None, redoc_url=None, openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-Klynx-Proxy-Key", "X-Klynx-Session", "X-Klynx-Client-IP"],
)


@app.get("/")
def root():
    return {"status": "Rental OS API"}


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    # Pydantic errors can include the submitted password in `input`.
    return JSONResponse(status_code=422, content={"detail": "Invalid request"})


@app.middleware("http")
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/ready")
def ready():
    app.state.control.verify()
    return {"status": "ready", "auth": "tenant-session-v1"}


app.include_router(auth_router)
for module in (cars, customers, leads, crm, sales, invoices, rentals, calendar, analytics, activities, booking_changes, search):
    app.include_router(module.router, dependencies=[Depends(require_session)])
