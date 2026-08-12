"""Sanctions / PEP / watchlist / adverse-media screening with defensible match logic.

Screening quality is a false-positive problem, not a matching problem: analysts drown when every
fuzzy name hit is escalated. So matches carry a decomposed score (name, date of birth, country,
identifier) plus a disposition band, and secondary identifiers can *demote* a strong name hit.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Entity, OwnershipEdge, Relationship, ScreeningHit
from app.providers import gateway
from app.services import audit
from app.services.resolution import normalise_name

LIST_SEVERITY: dict[str, str] = {
    "sanctions": "critical",
    "internal_watchlist": "high",
    "negative_file": "high",
    "pep": "medium",
    "adverse_media": "medium",
}


# Near misses below the alert threshold are still persisted down to this floor: the evidence that a
# strong name match was demoted on a secondary identifier is what makes the discount defensible.
RECORD_FLOOR = 0.45


@dataclass
class MatchScore:
    total: float
    components: dict[str, float] = field(default_factory=dict)
    demotions: list[str] = field(default_factory=list)


def score_match(subject: dict[str, Any], listing: dict[str, Any]) -> MatchScore:
    components: dict[str, float] = {}
    demotions: list[str] = []

    subject_name = normalise_name(subject.get("name"))
    names = [listing.get("name"), *(listing.get("aliases") or [])]
    name_score = max(
        (fuzz.token_set_ratio(subject_name, normalise_name(n)) / 100 for n in names if n),
        default=0.0,
    )
    components["name"] = name_score
    total = name_score

    subject_dob, listing_dob = subject.get("date_of_birth"), listing.get("date_of_birth")
    if subject_dob and listing_dob:
        if subject_dob == listing_dob:
            components["date_of_birth"] = 1.0
            total = min(1.0, total + 0.08)
        elif str(subject_dob)[:4] == str(listing_dob)[:4]:
            components["date_of_birth"] = 0.5
        else:
            components["date_of_birth"] = 0.0
            total *= 0.55
            demotions.append("date of birth conflicts with the listed subject")

    subject_country, listing_country = subject.get("country"), listing.get("country")
    if subject_country and listing_country:
        if subject_country.upper() == listing_country.upper():
            components["country"] = 1.0
            total = min(1.0, total + 0.04)
        else:
            components["country"] = 0.0
            total *= 0.85
            demotions.append("country of the listed subject differs")

    subject_id = (subject.get("identifier") or "").replace(" ", "").upper()
    listing_id = (listing.get("identifier") or "").replace(" ", "").upper()
    if subject_id and listing_id:
        if subject_id == listing_id:
            components["identifier"] = 1.0
            total = 1.0
        else:
            components["identifier"] = 0.0
            total *= 0.5
            demotions.append("strong identifier mismatch")

    return MatchScore(total=round(min(total, 1.0), 4), components=components, demotions=demotions)


def _disposition(score: float, list_type: str) -> tuple[str, bool]:
    settings = get_settings()
    if score >= settings.screening_strong_match:
        # Sanctions true matches are a hard stop; other lists still need human eyes.
        return ("true_match" if list_type == "sanctions" else "potential_match"), True
    if score >= settings.screening_hit_threshold:
        return "potential_match", True
    return "discounted", False


def _screening_population(session: Session, entity_id: int, max_hops: int = 3) -> list[Entity]:
    """Officers and the ownership chain, not just the entity (POL-SANC-001 §2).

    Screening only the applicant is the control gap that lets a listed person sit one level up in a
    holding company, so the ownership chain is walked and officers are included at every level.
    """
    seen: set[int] = {entity_id}
    frontier = [entity_id]
    population: list[Entity] = []
    for _ in range(max_hops):
        next_frontier: list[int] = []
        related_ids = [
            *[
                edge.owner_entity_id
                for edge in session.execute(
                    select(OwnershipEdge).where(OwnershipEdge.owned_entity_id.in_(frontier))
                ).scalars()
            ],
            *[
                rel.from_entity_id
                for rel in session.execute(
                    select(Relationship).where(
                        Relationship.to_entity_id.in_(frontier),
                        Relationship.rel_type.in_(["officer_of", "authorised_signatory"]),
                    )
                ).scalars()
            ],
        ]
        for related_id in related_ids:
            if related_id in seen:
                continue
            seen.add(related_id)
            related = session.get(Entity, related_id)
            if related is None:
                continue
            population.append(related)
            next_frontier.append(related_id)
        if not next_frontier:
            break
        frontier = next_frontier
    return population


def screen_entity(
    session: Session,
    entity_id: int,
    *,
    include_owners: bool = True,
    trigger: str = "manual",
    actor: str = "system",
) -> dict[str, Any]:
    entity = session.get(Entity, entity_id)
    if entity is None:
        raise LookupError(f"unknown entity {entity_id}")

    subjects = [entity, *(_screening_population(session, entity_id) if include_owners else [])]

    hits: list[dict[str, Any]] = []
    for subject in subjects:
        payload = {
            "name": subject.legal_name,
            "date_of_birth": subject.date_of_birth,
            "country": subject.country,
            "identifier": subject.registration_number,
        }
        result = gateway.call(
            session,
            provider="sanctions",
            operation="screen",
            params={"name": subject.legal_name, "country": subject.country},
            entity_id=entity_id,
            requested_by=actor,
        )
        for listing in result.data.get("entries", []):
            match = score_match(payload, listing)
            disposition, actionable = _disposition(match.total, listing["list_type"])
            if match.total < RECORD_FLOOR:
                continue
            hit = _persist_hit(
                session,
                entity_id=entity_id,
                subject=subject,
                listing=listing,
                match=match,
                disposition=disposition,
                trigger=trigger,
            )
            hits.append(
                {
                    "hit_id": hit.id,
                    "subject_entity_id": subject.id,
                    "subject_name": subject.legal_name,
                    "list_type": listing["list_type"],
                    "list_name": listing.get("list_name"),
                    "matched_name": listing["name"],
                    "programme": listing.get("programme"),
                    "score": match.total,
                    "components": match.components,
                    "demotions": match.demotions,
                    "disposition": disposition,
                    "severity": LIST_SEVERITY.get(listing["list_type"], "low"),
                    "actionable": actionable,
                    "listing_detail": listing.get("detail"),
                }
            )

        media = gateway.call(
            session,
            provider="adverse_media",
            operation="search",
            params={"name": subject.legal_name},
            entity_id=entity_id,
            requested_by=actor,
        )
        for article in media.data.get("articles", []):
            name_similarity = (
                fuzz.token_set_ratio(
                    normalise_name(subject.legal_name), normalise_name(article["subject"])
                )
                / 100
            )
            if name_similarity < 0.8:
                continue
            # Adverse media strength is subject confidence x source credibility, so a medium-severity
            # consumer complaint story cannot trip the same threshold as a credible AML allegation.
            score = round(min(1.0, name_similarity * float(article.get("credibility") or 0.0)), 4)
            listing = {
                "list_type": "adverse_media",
                "list_name": article["publication"],
                "name": article["subject"],
                "detail": article["headline"],
                "programme": article["category"],
                "published": article.get("published"),
                "credibility": article.get("credibility"),
            }
            match = MatchScore(total=score, components={"name": score})
            disposition = "potential_match" if score >= 0.6 else "discounted"
            hit = _persist_hit(
                session,
                entity_id=entity_id,
                subject=subject,
                listing=listing,
                match=match,
                disposition=disposition,
                trigger=trigger,
            )
            hits.append(
                {
                    "hit_id": hit.id,
                    "subject_entity_id": subject.id,
                    "subject_name": subject.legal_name,
                    "list_type": "adverse_media",
                    "list_name": article["publication"],
                    "matched_name": article["subject"],
                    "programme": article["category"],
                    "score": score,
                    "components": match.components,
                    "demotions": [],
                    "disposition": disposition,
                    "severity": "medium",
                    "actionable": disposition == "potential_match",
                    "listing_detail": article["headline"],
                }
            )

    hits.sort(key=lambda h: -h["score"])
    actionable_hits = [h for h in hits if h["actionable"]]
    summary = {
        "entity_id": entity_id,
        "screened_subjects": [s.legal_name for s in subjects],
        "hits": hits,
        "actionable_hits": actionable_hits,
        "sanctions_true_match": any(
            h["list_type"] == "sanctions" and h["disposition"] == "true_match" for h in hits
        ),
        "pep_exposure": any(h["list_type"] == "pep" and h["actionable"] for h in hits),
        "adverse_media_score": round(
            max((h["score"] for h in hits if h["list_type"] == "adverse_media"), default=0.0), 4
        ),
        "screened_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "trigger": trigger,
    }
    audit.append(
        session,
        actor=actor,
        action="screening.completed",
        subject_type="entity",
        subject_id=entity_id,
        payload={
            "trigger": trigger,
            "hit_count": len(hits),
            "actionable": len(actionable_hits),
            "sanctions_true_match": summary["sanctions_true_match"],
        },
    )
    return summary


def _persist_hit(
    session: Session,
    *,
    entity_id: int,
    subject: Entity,
    listing: dict[str, Any],
    match: MatchScore,
    disposition: str,
    trigger: str,
) -> ScreeningHit:
    existing = session.execute(
        select(ScreeningHit).where(
            ScreeningHit.entity_id == entity_id,
            ScreeningHit.subject_entity_id == subject.id,
            ScreeningHit.list_type == listing["list_type"],
            ScreeningHit.matched_name == listing["name"],
        )
    ).scalar()
    hit = existing or ScreeningHit(
        entity_id=entity_id,
        subject_entity_id=subject.id,
        list_type=listing["list_type"],
        matched_name=listing["name"],
    )
    hit.list_name = listing.get("list_name")
    hit.programme = listing.get("programme")
    hit.score = match.total
    hit.score_components = match.components
    hit.demotions = match.demotions
    hit.disposition = disposition if hit.reviewed_by is None else hit.disposition
    hit.detail = listing.get("detail")
    hit.trigger = trigger
    session.add(hit)
    session.flush()
    return hit


def review_hit(
    session: Session,
    hit_id: int,
    *,
    disposition: str,
    rationale: str,
    reviewer: str,
) -> ScreeningHit:
    """Analyst disposition. Recorded separately from the machine score so both survive audit."""
    if disposition not in {"true_match", "false_positive", "discounted", "potential_match"}:
        raise ValueError(f"invalid disposition {disposition}")
    hit = session.get(ScreeningHit, hit_id)
    if hit is None:
        raise LookupError(f"unknown screening hit {hit_id}")
    hit.disposition = disposition
    hit.review_rationale = rationale
    hit.reviewed_by = reviewer
    hit.reviewed_at = dt.datetime.now(dt.timezone.utc)
    session.flush()
    audit.append(
        session,
        actor=reviewer,
        actor_role="analyst",
        action="screening.hit_reviewed",
        subject_type="screening_hit",
        subject_id=hit.id,
        payload={
            "entity_id": hit.entity_id,
            "list_type": hit.list_type,
            "machine_score": hit.score,
            "disposition": disposition,
            "rationale": rationale,
        },
    )
    return hit
