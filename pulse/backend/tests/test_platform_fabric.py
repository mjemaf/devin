"""Foundation guarantees: bi-temporal facts, a durable event fabric, features and transactions.

These are the commitments the rest of the platform leans on (C1, C3, C7). If a fact can be mutated
in place, or an event only exists in memory, then no decision above them is replayable.
"""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Entity, Merchant, PlatformEvent, utcnow
from app.services import events, features, provenance, transactions


def _entity(session: Session) -> Entity:
    entity = session.execute(select(Entity)).scalars().first()
    assert entity is not None
    return entity


def test_superseding_a_fact_preserves_the_earlier_belief(session: Session) -> None:
    entity = _entity(session)
    first = provenance.record(
        session,
        subject_id=entity.id,
        attribute="test.registry_status",
        value="active",
        source="companies_house",
    )
    second = provenance.record(
        session,
        subject_id=entity.id,
        attribute="test.registry_status",
        value="dissolved",
        source="companies_house",
    )

    assert first.superseded_at is not None, "the old belief must be closed out, not overwritten"
    assert first.superseded_by_id == second.id
    assert first.value == "active"
    assert second.superseded_at is None

    current = provenance.effective(session, entity.id)["test.registry_status"]
    assert current.value == "dissolved"
    assert current.freshness in {"fresh", "ageing", "stale"}

    as_known_earlier = provenance.facts_for(
        session,
        entity.id,
        attribute="test.registry_status",
        knowledge_at=first.recorded_at,
    )
    assert [fact.value for fact in as_known_earlier] == ["active"]


def test_higher_confidence_source_wins_and_the_loser_is_kept_as_a_conflict(
    session: Session,
) -> None:
    entity = _entity(session)
    provenance.record(
        session,
        subject_id=entity.id,
        attribute="test.trading_address",
        value="1 Old Street",
        source="merchant_declaration",
        confidence=0.5,
    )
    provenance.record(
        session,
        subject_id=entity.id,
        attribute="test.trading_address",
        value="2 New Street",
        source="companies_house",
        confidence=0.95,
    )

    reconciled = provenance.effective(session, entity.id)["test.trading_address"]
    assert reconciled.value == "2 New Street"
    assert reconciled.resolution_rule == "highest_confidence_then_recency"
    assert any(conflict["value"] == "1 Old Street" for conflict in reconciled.conflicts)


def test_publish_is_durable_schema_checked_and_idempotent_on_replay(session: Session) -> None:
    before = session.scalar(select(PlatformEvent).order_by(PlatformEvent.id.desc()))
    entity = _entity(session)

    events.publish(
        session,
        events.Event(
            name=events.ENTITY_RESOLVED,
            subject_type="entity",
            subject_id=entity.id,
            payload={"entity_id": entity.id, "band": "auto_merge"},
        ),
    )
    persisted = session.scalar(select(PlatformEvent).order_by(PlatformEvent.id.desc()))
    assert persisted is not None
    assert persisted.topic == events.ENTITY_RESOLVED
    assert before is None or persisted.id > before.id

    with pytest.raises(events.SchemaError):
        events.publish(
            session,
            events.Event(
                name=events.ENTITY_RESOLVED, subject_type="entity", payload={"nothing": True}
            ),
        )

    dry = events.replay(session, topics=[events.ENTITY_RESOLVED], dry_run=True)
    assert dry["matched"] >= 1
    assert dry["redelivered"] == 0

    live = events.replay(session, topics=[events.ENTITY_RESOLVED], dry_run=False)
    again = events.replay(session, topics=[events.ENTITY_RESOLVED], dry_run=False)
    assert again["redelivered"] == 0, "a second replay must be a no-op for handlers already run"
    assert live["matched"] == again["matched"]


def test_topic_register_is_versioned_and_declares_retention() -> None:
    register = events.topic_register()
    assert register
    for topic in register:
        assert topic["topic"].startswith("risk.")
        assert topic["topic"].split(".")[-1].startswith("v")
        assert topic["retention_days"] >= 2557


def test_feature_vector_carries_its_definition_versions(session: Session) -> None:
    merchant = session.execute(select(Merchant)).scalars().first()
    assert merchant is not None
    vector = features.compute(session, merchant)
    assert vector["values"]
    assert set(vector["definition_versions"]) == set(vector["values"])

    with pytest.raises(features.UnknownFeature):
        features.compute(session, merchant, ["merchant.made_up_signal"])


def test_transactions_normalise_to_base_currency_and_deduplicate(session: Session) -> None:
    merchant = session.execute(
        select(Merchant).where(Merchant.platform_mid.is_not(None))
    ).scalars().first()
    assert merchant is not None

    raw = {
        "auth_id": "test-auth-1",
        "mid": merchant.platform_mid,
        "amount": 100.0,
        "currency": "GBP",
        "auth_time": utcnow() - dt.timedelta(hours=1),
        "mcc": merchant.mcc,
        "issuer_country": "GB",
        "entry_mode": "ecommerce",
    }
    first = transactions.normalise(session, raw=dict(raw))
    assert first is not None
    assert first.currency == "GBP"
    assert first.amount_base == transactions.to_base(100.0, "GBP")
    assert first.merchant_id == merchant.id

    assert transactions.normalise(session, raw=dict(raw)) is None, "same auth id must dedupe"

    with pytest.raises(transactions.NormalisationError):
        transactions.normalise(
            session, raw={**raw, "auth_id": "test-auth-2", "mid": "MID-does-not-exist"}
        )

    health = transactions.stream_health(session)
    assert health["events"] >= 1
    assert health["max_normalisation_ms"] <= health["target_p99_ms"]
