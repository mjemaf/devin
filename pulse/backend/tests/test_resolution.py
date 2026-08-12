"""Entity resolution: confidence bands, and negative evidence that must beat similarity."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Entity
from app.services import resolution


def _resolve(session: Session, payload: dict[str, Any], ref: str) -> resolution.ResolutionResult:
    return resolution.resolve(
        session, source_system="test", source_ref=ref, payload={"entity_type": "company", **payload}
    )


def test_deterministic_match_on_registration_number(session: Session) -> None:
    payload = {
        "legal_name": "Kestrel Analytics Limited",
        "country": "GB",
        "registration_number": "TST0000001",
        "address": "12 Beaumont Way, Manchester, M1 4AA, GB",
        "website": "https://kestrel-analytics.co.uk",
    }
    first = _resolve(session, payload, "REF-1")
    assert first.created is True
    assert first.band == "new_entity"

    # The same company arriving with sloppier data: only the registration number and country agree.
    second = _resolve(
        session,
        {
            "legal_name": "KESTREL ANALYTICS LTD",
            "country": "GB",
            "registration_number": "TST0000001",
        },
        "REF-2",
    )
    assert second.entity_id == first.entity_id
    assert second.created is False
    assert second.confidence >= get_settings().resolution_auto_merge
    assert second.method.startswith("deterministic")


def test_name_only_similarity_does_not_merge(session: Session) -> None:
    original = _resolve(
        session,
        {
            "legal_name": "Ferrymead Logistics Limited",
            "country": "GB",
            "registration_number": "TST0000002",
            "address": "5 Dock Road, Liverpool, L3 4BB, GB",
        },
        "REF-3",
    )
    lookalike = _resolve(
        session,
        {
            "legal_name": "Ferrymead Logistic Ltd",
            "country": "GB",
            "address": "88 Wharfside Street, Birmingham, B1 1RF, GB",
        },
        "REF-4",
    )
    assert lookalike.entity_id != original.entity_id
    assert lookalike.band in {"review", "new_entity"}
    assert lookalike.review_required is (lookalike.band == "review")


def test_different_registration_number_blocks_the_merge(session: Session) -> None:
    """A reincarnated company must not be absorbed into the entity it is impersonating."""
    shared = {
        "country": "GB",
        "address": "3 Harbour Parade, Bristol, BS1 5UH, GB",
        "legal_name": "Harbourline Trading Ltd",
    }
    incumbent = _resolve(session, {**shared, "registration_number": "TST0000003"}, "REF-5")
    successor_payload = {**shared, "registration_number": "TST0000004"}

    incumbent_entity = session.get(Entity, incumbent.entity_id)
    assert incumbent_entity is not None
    assert resolution.contradicted(successor_payload, incumbent_entity) is True

    successor = _resolve(session, successor_payload, "REF-6")
    assert successor.entity_id != incumbent.entity_id
    assert successor.created is True
    assert any(
        candidate.method == "probabilistic:contradicted" for candidate in successor.candidates
    )
    both = session.execute(
        select(Entity).where(Entity.legal_name == "Harbourline Trading Ltd")
    ).scalars().all()
    assert len(both) == 2


def test_resolution_records_feature_contributions_for_explainability(session: Session) -> None:
    payload = {
        "legal_name": "Aldergate Media Ltd",
        "country": "GB",
        "registration_number": "TST0000005",
        "address": "1 Aldergate Square, Leeds, LS2 7HH, GB",
    }
    first = _resolve(session, payload, "REF-7")
    repeat = _resolve(session, payload, "REF-8")
    assert repeat.entity_id == first.entity_id
    assert repeat.contributions
    assert all(0.0 <= value <= 1.0 for value in repeat.contributions.values())
    assert sum(repeat.contributions.values()) > 0.5
