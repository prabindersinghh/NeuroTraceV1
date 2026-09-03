"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from . import __version__
from .config import apply_seed, settings
from .db import engine
from .routers import admin as admin_router, asha as asha_router
from .routers import clinician as clinician_router
from .routers import auth as auth_router
from .routers import awaaz as awaaz_router
from .routers import caretaker as caretaker_router
from .routers import clinical_data as clinical_router
from .routers import consent as consent_router
from .routers import dashboard as dashboard_router
from .routers import demo as demo_router
from .routers import patients as patients_router
from .routers import safety as safety_router
from .routers import sessions as sessions_router
from .routers import wearable as wearable_router
from .schemas import HealthResponse

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("neurotrace")


@asynccontextmanager
async def lifespan(app: FastAPI):
    apply_seed()
    logger.info("NeuroTrace %s starting (env=%s, seed=%s)", __version__, settings.env, settings.seed)
    yield
    await engine.dispose()
    logger.info("NeuroTrace stopped")


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description=(
        "NeuroTrace — daily neurological check-in on the patient's own phone. Learns each patient's personal "
        "baseline from voice, face and reaction time, and flags sustained multi-signal deviation."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    # A token pair must never sit in a browser or proxy cache; /auth/* is the only place
    # one is ever returned.
    if request.url.path.startswith("/auth/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Ensure any unhandled 500 error carries CORS headers so browsers never mask it as a CORS violation."""
    logger.exception("Unhandled server error handling %s %s: %s", request.method, request.url.path, exc)
    origin = request.headers.get("origin")
    headers: dict[str, str] = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
    }
    if origin and (origin in settings.cors_origins or "*" in settings.cors_origins):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
        headers["Vary"] = "Origin"
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
        headers=headers,
    )



app.include_router(auth_router.router)
app.include_router(patients_router.router)
app.include_router(sessions_router.router)
app.include_router(clinical_router.router)
app.include_router(dashboard_router.router)
app.include_router(safety_router.router)
app.include_router(demo_router.router)
app.include_router(wearable_router.router)
app.include_router(asha_router.router)
app.include_router(awaaz_router.router)
app.include_router(admin_router.router)
app.include_router(clinician_router.router)
app.include_router(consent_router.router)
app.include_router(caretaker_router.router)


@app.get("/health", response_model=HealthResponse, tags=["meta"])
async def health() -> HealthResponse:
    database = "unknown"
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        database = "up"
    except Exception:  # noqa: BLE001 - health must never raise
        database = "down"
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        version=__version__,
        env=settings.env,
        database=database,
    )


@app.get("/", tags=["meta"])
async def root() -> dict:
    return {"app": settings.app_name, "version": __version__, "docs": "/docs"}
