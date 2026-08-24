"""Test harness.

The database URL is set before any application module is imported, because ``app.db`` builds the
engine at import time from settings — so a stray early import would bind the tests to the
development database.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

_TMP_DIR = Path(tempfile.mkdtemp(prefix="pulse-tests-"))
os.environ["PULSE_DATABASE_URL"] = f"sqlite:///{_TMP_DIR / 'pulse-test.db'}"
os.environ["PULSE_SEED_ON_STARTUP"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app import seed  # noqa: E402
from app.db import create_all, engine, session_scope  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.services import monitoring  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def seeded_platform() -> Iterator[dict[str, object]]:
    """One seeded portfolio for the whole session: it is the fixture the scenarios are written against."""
    create_all()
    monitoring.register_handlers()
    summary = seed.run()
    yield summary
    Base.metadata.drop_all(engine)


@pytest.fixture()
def session() -> Iterator[Session]:
    with session_scope() as db_session:
        yield db_session


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


# X-API-Key headers for the demo credential directory (app.config.Settings.api_credentials),
# one per role, so tests can exercise governance endpoints as a specific authenticated identity
# instead of asserting identity/role in the request body.
ANALYST = {"X-API-Key": "demo-analyst-key"}
SENIOR_ANALYST = {"X-API-Key": "demo-senior-analyst-key"}
CREDIT_OFFICER = {"X-API-Key": "demo-credit-officer-key"}
RISK_OWNER = {"X-API-Key": "demo-risk-owner-key"}
SECOND_LINE = {"X-API-Key": "demo-second-line-key"}
AUDITOR = {"X-API-Key": "demo-auditor-key"}
