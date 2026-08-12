"""Screening: match scoring with demotions, thresholds, population and analyst disposition."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Entity, ScreeningHit
from app.services import screening

LISTING = {
    "name": "Viktor Andreev",
    "aliases": ["V. Andreev"],
    "date_of_birth": "1968-03-11",
    "country": "RU",
    "identifier": "PASS-772311",
}


def test_exact_name_and_identifiers_scores_a_strong_match() -> None:
    score = screening.score_match(
        {
            "name": "Viktor Andreev",
            "date_of_birth": "1968-03-11",
            "country": "RU",
            "identifier": "PASS-772311",
        },
        LISTING,
    )
    assert score.total >= get_settings().screening_strong_match
    assert score.demotions == []


def test_date_of_birth_conflict_demotes_a_name_only_match() -> None:
    subject = {"name": "Viktor Andreev", "date_of_birth": "1985-11-02", "country": "RU"}
    name_only = screening.score_match({"name": "Viktor Andreev"}, LISTING)
    demoted = screening.score_match(subject, LISTING)

    assert name_only.total > demoted.total
    assert demoted.total < get_settings().screening_hit_threshold
    assert any("date of birth" in reason for reason in demoted.demotions)


def test_identifier_mismatch_demotes_even_an_exact_name() -> None:
    demoted = screening.score_match(
        {"name": "Viktor Andreev", "identifier": "PASS-000000"}, LISTING
    )
    assert demoted.total < get_settings().screening_hit_threshold
    assert any("identifier" in reason for reason in demoted.demotions)


def test_dispositions_follow_the_configured_thresholds() -> None:
    settings = get_settings()
    strong, actionable = screening._disposition(settings.screening_strong_match + 0.01, "sanctions")
    assert (strong, actionable) == ("true_match", True)

    # The same score on a non-sanctions list still needs a human, never an automatic true match.
    media, media_actionable = screening._disposition(
        settings.screening_strong_match + 0.01, "adverse_media"
    )
    assert (media, media_actionable) == ("potential_match", True)

    borderline = screening._disposition(settings.screening_hit_threshold, "pep")
    assert borderline == ("potential_match", True)

    below = screening._disposition(settings.screening_hit_threshold - 0.01, "sanctions")
    assert below == ("discounted", False)


def test_screening_covers_officers_and_the_ownership_chain(session: Session) -> None:
    halcyon = session.execute(
        select(Entity).where(Entity.legal_name == "Halcyon Wellness Ltd")
    ).scalars().one()
    summary = screening.screen_entity(session, halcyon.id, trigger="test")

    assert summary["entity_id"] == halcyon.id
    assert len(summary["screened_subjects"]) > 1, "only the applicant was screened"
    assert "Halcyon Wellness Ltd" in summary["screened_subjects"]
    for hit in summary["hits"]:
        assert hit["list_type"] in {"sanctions", "pep", "watchlist", "negative_file", "adverse_media"}
        assert 0.0 <= hit["score"] <= 1.0
        assert hit["components"]


def test_negative_file_match_is_surfaced_for_the_reincarnated_applicant(session: Session) -> None:
    halcyon = session.execute(
        select(Entity).where(Entity.legal_name == "Halcyon Wellness Ltd")
    ).scalars().one()
    summary = screening.screen_entity(session, halcyon.id, trigger="test")
    assert any(hit["list_type"] == "negative_file" for hit in summary["hits"])


def test_analyst_disposition_is_recorded_alongside_the_machine_score(session: Session) -> None:
    hit = session.execute(
        select(ScreeningHit).where(ScreeningHit.list_type == "adverse_media")
    ).scalars().first()
    assert hit is not None
    machine_score = hit.score

    reviewed = screening.review_hit(
        session,
        hit.id,
        disposition="false_positive",
        rationale="Article concerns a different company with a similar trading name.",
        reviewer="analyst@pulse.example",
    )
    assert reviewed.disposition == "false_positive"
    assert reviewed.reviewed_by == "analyst@pulse.example"
    assert reviewed.reviewed_at is not None
    assert reviewed.score == machine_score, "the machine score must survive the human override"
