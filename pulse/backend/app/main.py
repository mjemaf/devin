"""Pulse API entrypoint.

Startup wires the platform spine in the order the architecture requires: schema, then event
subscriptions (monitoring is event-driven, so handlers must exist before anything publishes), then
the synthetic portfolio if the database is empty.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import seed
from app.api.routes import router
from app.config import get_settings
from app.db import create_all
from app.services import monitoring

logger = logging.getLogger("pulse")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    create_all()
    monitoring.register_handlers()
    if settings.seed_on_startup:
        summary = seed.run()
        logger.info("seed: %s", summary.get("reason") or "portfolio created")
    yield


app = FastAPI(
    title="Pulse — Risk & Compliance Platform",
    version="0.1.0",
    description=(
        "Reference implementation of the Pulse platform: canonical entity intelligence, grounded "
        "policy knowledge, policy-as-code decisioning, perpetual monitoring and governed agentic "
        "automation over a tamper-evident audit chain."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")
