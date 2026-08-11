"""The seeded portfolio is the shared fixture for the scenario tests, so assert it actually built."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ARP, Document, Entity, Merchant, Monitor
from app.services import audit


def test_seed_built_the_portfolio(seeded_platform: dict[str, object], session: Session) -> None:
    assert seeded_platform["seeded"] is True
    assert len(session.execute(select(Merchant)).scalars().all()) >= 8
    assert len(session.execute(select(Entity)).scalars().all()) >= 15
    assert len(session.execute(select(Document)).scalars().all()) >= 5
    assert len(session.execute(select(ARP)).scalars().all()) >= 3
    assert len(session.execute(select(Monitor)).scalars().all()) >= 3
    assert audit.verify(session)["valid"] is True
