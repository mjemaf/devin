"""True merchant identification: resolve fragmented identifiers to one entity, with confidence.

Two-stage, as production entity resolution should be:

1. **Deterministic** — an exact (country, registration number) or tax-id match is a decision, not
   a similarity score.
2. **Probabilistic** — weighted feature agreement (name, address, website domain, email domain,
   phone) producing a confidence score and per-feature contributions.

Confidence bands drive behaviour, not a single threshold: auto-merge, human review, or new
entity. Every merge is reversible because the pre-resolution :class:`SourceRecord` survives.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Entity, SourceRecord
from app.services import audit, events

_SUFFIXES = re.compile(
    r"\b(limited|ltd|plc|llc|inc|incorporated|corp|corporation|gmbh|se|bv|b\.v\.|nv|sarl|sa|ag|"
    r"oy|ab|as|aps|srl|spa|pty|pte|kk|co|company)\b\.?",
    re.IGNORECASE,
)

FEATURE_WEIGHTS: dict[str, float] = {
    "name": 0.38,
    "address": 0.18,
    "website": 0.18,
    "email_domain": 0.12,
    "country": 0.06,
}


def normalise_name(name: str | None) -> str:
    if not name:
        return ""
    cleaned = _SUFFIXES.sub(" ", name.lower())
    cleaned = re.sub(r"[^a-z0-9 ]+", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _domain(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip().lower()
    if "@" in value:
        return value.split("@", 1)[1]
    if "://" not in value:
        value = f"https://{value}"
    host = urlparse(value).netloc
    return host[4:] if host.startswith("www.") else host


def _digits(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def _identifier(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


class ResolutionError(RuntimeError):
    """Raised when the resolver cannot produce a canonical entity."""


@dataclass
class ResolutionCandidate:
    entity_id: int
    legal_name: str
    confidence: float
    method: str
    contributions: dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "legal_name": self.legal_name,
            "confidence": round(self.confidence, 4),
            "method": self.method,
            "contributions": {k: round(v, 4) for k, v in self.contributions.items()},
        }


@dataclass
class ResolutionResult:
    entity_id: int
    created: bool
    confidence: float
    method: str
    band: str  # auto_merge | review | new_entity
    review_required: bool
    contributions: dict[str, float]
    candidates: list[ResolutionCandidate]
    source_record_id: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "created": self.created,
            "confidence": round(self.confidence, 4),
            "method": self.method,
            "band": self.band,
            "review_required": self.review_required,
            "contributions": {k: round(v, 4) for k, v in self.contributions.items()},
            "candidates": [c.as_dict() for c in self.candidates],
            "source_record_id": self.source_record_id,
        }


def contradicted(payload: dict[str, Any], entity: Entity) -> bool:
    """Negative evidence beats similarity: two registration numbers in one country are two firms.

    Without this, a reincarnated company sharing an address and half a name with a previously
    offboarded one gets absorbed into it, and the network link that should be the alert disappears.
    """
    reg_a = _identifier(payload.get("registration_number"))
    reg_b = _identifier(entity.registration_number)
    country_a = (payload.get("country") or "").upper()
    country_b = (entity.country or "").upper()
    return bool(reg_a and reg_b and reg_a != reg_b and country_a == country_b)


def score_candidate(payload: dict[str, Any], entity: Entity) -> tuple[float, dict[str, float]]:
    """Weighted feature agreement. Missing features are dropped and weights renormalised."""
    contributions: dict[str, float] = {}
    available = 0.0

    name_a, name_b = normalise_name(payload.get("legal_name")), normalise_name(entity.legal_name)
    trading = normalise_name(entity.trading_name)
    if name_a and (name_b or trading):
        similarity = max(
            fuzz.token_set_ratio(name_a, name_b) / 100 if name_b else 0.0,
            fuzz.token_set_ratio(name_a, trading) / 100 if trading else 0.0,
        )
        contributions["name"] = similarity * FEATURE_WEIGHTS["name"]
        available += FEATURE_WEIGHTS["name"]

    if payload.get("address") and entity.address:
        similarity = fuzz.token_set_ratio(payload["address"].lower(), entity.address.lower()) / 100
        contributions["address"] = similarity * FEATURE_WEIGHTS["address"]
        available += FEATURE_WEIGHTS["address"]

    site_a, site_b = _domain(payload.get("website")), _domain(entity.website)
    if site_a and site_b:
        contributions["website"] = (1.0 if site_a == site_b else 0.0) * FEATURE_WEIGHTS["website"]
        available += FEATURE_WEIGHTS["website"]

    email_a = _domain(payload.get("email"))
    if email_a and site_b:
        contributions["email_domain"] = (
            1.0 if email_a == site_b else 0.0
        ) * FEATURE_WEIGHTS["email_domain"]
        available += FEATURE_WEIGHTS["email_domain"]

    if payload.get("country") and entity.country:
        same = payload["country"].upper() == entity.country.upper()
        contributions["country"] = (1.0 if same else 0.0) * FEATURE_WEIGHTS["country"]
        available += FEATURE_WEIGHTS["country"]

    if available == 0:
        return 0.0, {}
    return sum(contributions.values()) / available, contributions


def resolve(
    session: Session,
    *,
    source_system: str,
    source_ref: str,
    payload: dict[str, Any],
    actor: str = "system",
) -> ResolutionResult:
    settings = get_settings()

    existing = session.execute(
        select(SourceRecord).where(
            SourceRecord.source_system == source_system, SourceRecord.source_ref == source_ref
        )
    ).scalar()
    record = existing or SourceRecord(
        source_system=source_system, source_ref=source_ref, payload=payload
    )
    record.payload = payload
    session.add(record)
    session.flush()

    reg_number = _identifier(payload.get("registration_number"))
    country = (payload.get("country") or "").upper()

    candidates: list[ResolutionCandidate] = []
    deterministic: Entity | None = None
    if reg_number and country:
        for entity in session.execute(select(Entity).where(Entity.country == country)).scalars():
            if _identifier(entity.registration_number) == reg_number:
                deterministic = entity
                break

    if deterministic is not None:
        candidates.append(
            ResolutionCandidate(
                entity_id=deterministic.id,
                legal_name=deterministic.legal_name,
                confidence=1.0,
                method="deterministic:registration_number",
                contributions={"registration_number": 1.0},
            )
        )
        chosen, created, band = deterministic, False, "auto_merge"
        confidence, method, contributions = 1.0, "deterministic:registration_number", {
            "registration_number": 1.0
        }
    else:
        for entity in session.execute(
            select(Entity).where(Entity.entity_type == payload.get("entity_type", "company"))
        ).scalars():
            confidence, contributions = score_candidate(payload, entity)
            if confidence <= 0.4:
                continue
            blocked = contradicted(payload, entity)
            candidates.append(
                ResolutionCandidate(
                    entity_id=entity.id,
                    legal_name=entity.legal_name,
                    confidence=confidence,
                    method="probabilistic:contradicted" if blocked else "probabilistic",
                    contributions=contributions,
                )
            )
        candidates.sort(key=lambda c: -c.confidence)
        mergeable = [c for c in candidates if c.method == "probabilistic"]
        best = mergeable[0] if mergeable else None

        if best and best.confidence >= settings.resolution_auto_merge:
            merged = session.get(Entity, best.entity_id)
            if merged is None:
                raise ResolutionError(f"candidate entity {best.entity_id} disappeared mid-resolution")
            chosen = merged
            created, band = False, "auto_merge"
            confidence, method, contributions = (
                best.confidence,
                "probabilistic",
                best.contributions,
            )
        else:
            # Below the auto-merge bar we keep the entities apart and let a human decide: an
            # incorrect merge is far harder to unwind than an unnecessary duplicate.
            review = best is not None and best.confidence >= settings.resolution_review_floor
            chosen = Entity(
                entity_type=payload.get("entity_type", "company"),
                legal_name=payload.get("legal_name") or "Unknown",
                trading_name=payload.get("trading_name"),
                country=country or None,
                registration_number=reg_number or None,
                website=payload.get("website"),
                address=payload.get("address"),
                date_of_birth=payload.get("date_of_birth"),
                resolution_confidence=1.0,
            )
            session.add(chosen)
            session.flush()
            created, band = True, "review" if review else "new_entity"
            confidence, method, contributions = (
                best.confidence if best else 0.0,
                "new_entity",
                best.contributions if best else {},
            )

    record.resolved_entity_id = chosen.id
    record.match_confidence = confidence
    record.match_method = method
    record.match_contributions = {k: round(v, 4) for k, v in contributions.items()}
    record.review_required = band == "review"
    if not created:
        chosen.resolution_confidence = min(chosen.resolution_confidence, confidence or 1.0)
        # Backfill identifiers the winning record supplies and the entity lacks.
        chosen.registration_number = chosen.registration_number or (reg_number or None)
        chosen.website = chosen.website or payload.get("website")
        chosen.address = chosen.address or payload.get("address")
    session.flush()

    audit.append(
        session,
        actor=actor,
        action="entity.resolved",
        subject_type="entity",
        subject_id=chosen.id,
        payload={
            "source_system": source_system,
            "source_ref": source_ref,
            "band": band,
            "confidence": round(confidence, 4),
            "method": method,
            "contributions": {k: round(v, 4) for k, v in contributions.items()},
            "created_entity": created,
        },
    )
    events.publish(
        session,
        events.Event(
            name=events.ENTITY_RESOLVED,
            subject_type="entity",
            subject_id=chosen.id,
            payload={
                "entity_id": chosen.id,
                "source_system": source_system,
                "source_ref": source_ref,
                "band": band,
                "confidence": round(confidence, 4),
                "method": method,
                "created_entity": created,
            },
        ),
    )

    return ResolutionResult(
        entity_id=chosen.id,
        created=created,
        confidence=confidence,
        method=method,
        band=band,
        review_required=band == "review",
        contributions=contributions,
        candidates=candidates[:5],
        source_record_id=record.id,
    )
