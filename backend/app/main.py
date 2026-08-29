"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
