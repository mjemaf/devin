"""PLS-14 provenance and PLS-10 source registry: bi-temporal facts that can be cited.

Nothing in Pulse asserts a value without being able to say where it came from, when it was true,
when Pulse learned it, how stale it is and what else disagreed. That is what makes C1 (every answer
carries citations with provenance and freshness) enforceable rather than aspirational.

Two temporal axes, per P3:

* world time — ``valid_from`` / ``valid_to``: when the assertion was true of the world.
* system time — ``recorded_at`` / ``superseded_at``: when Pulse believed it.

Conflicts are kept, not overwritten. :func:`effective` picks a winner with a *named* rule
(``highest_confidence_then_recency``) and reports the losers, so an analyst can always see the
competing registry record rather than a silently chosen one.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Fact, SourceFeed, utcnow

RESOLUTION_RULE = "highest_confidence_then_recency"

# Registered inbound sources (PLS-10). Freshness SLA drives the staleness banding below; the
# criticality tier maps onto the availability tiers in the architecture NFRs.
SOURCES: tuple[dict[str, Any], ...] = (
    {
        "key": "registry",
        "description": "Company registry: legal name, status, incorporation, officers, ownership",
        "owner": "kyb.ops@pulse.example",
        "extraction_method": "api",
        "freshness_sla_minutes": 1440,
        "criticality_tier": 1,
        "contains_pii": True,
    },
    {
        "key": "sanctions",
        "description": "Consolidated sanctions, PEP and watchlist screening lists",
        "owner": "sanctions.ops@pulse.example",
        "extraction_method": "api",
        "freshness_sla_minutes": 60,
        "criticality_tier": 0,
        "contains_pii": True,
    },
    {
        "key": "adverse_media",
        "description": "Adverse media search results with publication dates",
        "owner": "financial.crime@pulse.example",
        "extraction_method": "api",
        "freshness_sla_minutes": 10080,
        "criticality_tier": 2,
        "contains_pii": True,
    },
    {
        "key": "bureau",
        "description": "Credit bureau file and trade payment history",
        "owner": "credit.risk@pulse.example",
        "extraction_method": "api",
        "freshness_sla_minutes": 43200,
        "criticality_tier": 2,
        "contains_pii": True,
    },
    {
        "key": "application",
        "description": "Merchant-declared application data",
        "owner": "onboarding@pulse.example",
        "extraction_method": "declared",
        "freshness_sla_minutes": 525600,
        "criticality_tier": 2,
        "contains_pii": True,
    },
    {
        "key": "acquiring",
        "description": "Authorisation, settlement and chargeback streams",
        "owner": "payments.platform@pulse.example",
        "extraction_method": "stream",
        "freshness_sla_minutes": 15,
        "criticality_tier": 0,
        "contains_pii": False,
    },
    {
        "key": "internal",
        "description": "Analyst-entered observations and platform-derived attributes",
        "owner": "risk.ops@pulse.example",
        "extraction_method": "derived",
        "freshness_sla_minutes": 525600,
        "criticality_tier": 3,
        "contains_pii": False,
    },
)

_BY_KEY: dict[str, dict[str, Any]] = {source["key"]: source for source in SOURCES}


def install(session: Session) -> list[SourceFeed]:
    """Register the declared feeds. Idempotent; run at startup."""
    installed: list[SourceFeed] = []
    for spec in SOURCES:
        feed = session.execute(
            select(SourceFeed).where(SourceFeed.key == spec["key"])
        ).scalars().first()
        if feed is None:
            feed = SourceFeed(key=str(spec["key"]))
            session.add(feed)
        feed.description = str(spec["description"])
        feed.owner = str(spec["owner"])
        feed.extraction_method = str(spec["extraction_method"])
        feed.freshness_sla_minutes = int(spec["freshness_sla_minutes"])
        feed.criticality_tier = int(spec["criticality_tier"])
        feed.contains_pii = bool(spec["contains_pii"])
        installed.append(feed)
    session.flush()
    return installed


def mark_success(session: Session, source: str) -> None:
    feed = session.execute(select(SourceFeed).where(SourceFeed.key == source)).scalars().first()
    if feed is not None:
        feed.last_success_at = utcnow()
        session.flush()


def mark_failure(session: Session, source: str, reason: str) -> None:
    feed = session.execute(select(SourceFeed).where(SourceFeed.key == source)).scalars().first()
    if feed is not None:
        feed.last_failure_at = utcnow()
        feed.last_failure_reason = reason[:255]
        session.flush()


def sla_minutes(source: str) -> int:
    spec = _BY_KEY.get(source)
    return int(spec["freshness_sla_minutes"]) if spec else 1440


FRESHNESS_RANK: dict[str, int] = {"fresh": 0, "ageing": 1, "stale": 2, "unobserved": 3}

# Decision and score inputs that no single feed asserts: a component computes them. Each family
# names its producing component and the source facts it is computed from, so a derived input in a
# decision is still attributable rather than appearing from nowhere (C1).
DERIVED_INPUTS: dict[str, tuple[str, tuple[str, ...]]] = {
    "entity.": ("PLS-17 Reference & Master Data Binding", ("registry.registered_address",)),
    "resolution.": (
        "PLS-21 Entity Resolution",
        ("registry.legal_name", "registry.registered_address"),
    ),
    "kyb.": (
        "PLS-11 Third-Party Vendor Gateway",
        ("registry.status", "registry.legal_name", "registry.registered_address", "registry.sic_codes"),
    ),
    "screening.": ("PLS-42 Screening", ()),
    "network.": ("PLS-22 Knowledge Graph", ()),
    "merchant.": ("PLS-27 Merchant 360 Projection", ()),
    "credit.": ("PLS-31 Scoring & Model Serving", ()),
}


def freshness_band(age_minutes: float, source: str) -> str:
    """``fresh`` within SLA, ``ageing`` within 3x, ``stale`` beyond — never silently hidden."""
    sla = sla_minutes(source)
    if age_minutes <= sla:
        return "fresh"
    if age_minutes <= sla * 3:
        return "ageing"
    return "stale"


def content_hash(value: Any) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def record(
    session: Session,
    *,
    subject_id: int,
    attribute: str,
    value: Any,
    source: str,
    subject_type: str = "entity",
    confidence: float = 1.0,
    as_of: dt.datetime | None = None,
    valid_from: dt.datetime | None = None,
    valid_to: dt.datetime | None = None,
    extraction_method: str | None = None,
    source_ref: str | None = None,
    classification: str = "internal",
) -> Fact:
    """Assert a fact.

    A same-source assertion of the same attribute closes out its predecessor in system time
    (``superseded_at``) rather than mutating it: the old belief stays queryable so a past decision can
    be replayed against what was known at the time.
    """
    now = utcnow()
    observed = as_of or now
    previous = session.execute(
        select(Fact).where(
            Fact.subject_type == subject_type,
            Fact.subject_id == subject_id,
            Fact.attribute == attribute,
            Fact.source == source,
            Fact.superseded_at.is_(None),
        )
    ).scalars().all()

    fact = Fact(
        subject_type=subject_type,
        subject_id=subject_id,
        attribute=attribute,
        value=None if value is None else str(value),
        source=source,
        confidence=confidence,
        as_of=observed,
        valid_from=valid_from or observed,
        valid_to=valid_to,
        recorded_at=now,
        extraction_method=extraction_method or str(_BY_KEY.get(source, {}).get("extraction_method", "api")),
        source_ref=source_ref,
        content_hash=content_hash(value),
        classification=classification,
    )
    session.add(fact)
    session.flush()
    for stale in previous:
        stale.superseded_at = now
        stale.superseded_by_id = fact.id
    session.flush()
    mark_success(session, source)
    return fact


def facts_for(
    session: Session,
    subject_id: int,
    *,
    subject_type: str = "entity",
    attribute: str | None = None,
    as_of: dt.datetime | None = None,
    knowledge_at: dt.datetime | None = None,
) -> list[Fact]:
    """Facts true at ``as_of`` (world time) as known at ``knowledge_at`` (system time)."""
    stmt = select(Fact).where(Fact.subject_type == subject_type, Fact.subject_id == subject_id)
    if attribute:
        stmt = stmt.where(Fact.attribute == attribute)
    rows = list(session.execute(stmt.order_by(Fact.id)).scalars().all())
    world = as_of
    system = knowledge_at
    selected: list[Fact] = []
    for row in rows:
        if system is not None and row.recorded_at > system:
            continue
        if system is not None and row.superseded_at is not None and row.superseded_at <= system:
            continue
        if system is None and row.superseded_at is not None:
            continue
        if world is not None:
            if row.valid_from > world:
                continue
            if row.valid_to is not None and row.valid_to <= world:
                continue
        selected.append(row)
    return selected


@dataclass
class EffectiveFact:
    attribute: str
    value: str | None
    source: str
    confidence: float
    as_of: dt.datetime
    age_minutes: float
    freshness: str
    extraction_method: str
    classification: str
    conflicts: list[dict[str, Any]]
    resolution_rule: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "attribute": self.attribute,
            "value": self.value,
            "source": self.source,
            "confidence": round(self.confidence, 3),
            "as_of": self.as_of,
            "age_minutes": round(self.age_minutes, 1),
            "freshness": self.freshness,
            "extraction_method": self.extraction_method,
            "classification": self.classification,
            "conflicts": self.conflicts,
            "resolution_rule": self.resolution_rule,
        }


def effective(
    session: Session,
    subject_id: int,
    *,
    subject_type: str = "entity",
    as_of: dt.datetime | None = None,
    knowledge_at: dt.datetime | None = None,
) -> dict[str, EffectiveFact]:
    """The reconciled view: one winner per attribute, with the losers named."""
    rows = facts_for(
        session,
        subject_id,
        subject_type=subject_type,
        as_of=as_of,
        knowledge_at=knowledge_at,
    )
    grouped: dict[str, list[Fact]] = {}
    for row in rows:
        grouped.setdefault(row.attribute, []).append(row)

    now = knowledge_at or utcnow()
    out: dict[str, EffectiveFact] = {}
    for attribute, candidates in grouped.items():
        ranked = sorted(candidates, key=lambda f: (f.confidence, f.as_of), reverse=True)
        winner = ranked[0]
        losers = [row for row in ranked[1:] if row.value != winner.value]
        if losers:
            winner.conflict_set = [row.id for row in losers]
            winner.resolution_rule = RESOLUTION_RULE
        age = max(0.0, (now - winner.as_of).total_seconds() / 60.0)
        out[attribute] = EffectiveFact(
            attribute=attribute,
            value=winner.value,
            source=winner.source,
            confidence=winner.confidence,
            as_of=winner.as_of,
            age_minutes=age,
            freshness=freshness_band(age, winner.source),
            extraction_method=winner.extraction_method,
            classification=winner.classification,
            conflicts=[
                {"source": row.source, "value": row.value, "confidence": row.confidence}
                for row in losers
            ],
            resolution_rule=RESOLUTION_RULE if losers else "uncontested",
        )
    session.flush()
    return out


def _derived_citation(
    attribute: str, reconciled: dict[str, EffectiveFact]
) -> dict[str, Any] | None:
    """Cite a derived input by naming the component that produced it and its supporting facts."""
    for prefix, (origin, sources) in DERIVED_INPUTS.items():
        if not attribute.startswith(prefix):
            continue
        supporting = [reconciled[source].as_dict() for source in sources if source in reconciled]
        bands = [str(entry["freshness"]) for entry in supporting]
        return {
            "attribute": attribute,
            "provenance": "derived",
            "origin": origin,
            "derived_from": supporting,
            "freshness": (
                max(bands, key=lambda band: FRESHNESS_RANK[band]) if bands else "unobserved"
            ),
        }
    return None


def citation_bundle(
    session: Session,
    subject_id: int,
    attributes: list[str],
    *,
    subject_type: str = "entity",
) -> list[dict[str, Any]]:
    """The provenance block attached to a score, decision or answer (C1).

    Decision inputs are a mixture of source facts read straight from a feed and values derived by a
    component from several of them. Both are citable: a derived input names its producing component
    and the facts underneath it, so no input in a decision is left unattributed.
    """
    reconciled = effective(session, subject_id, subject_type=subject_type)
    bundle: list[dict[str, Any]] = []
    for attribute in attributes:
        if attribute in reconciled:
            bundle.append(reconciled[attribute].as_dict())
            continue
        derived = _derived_citation(attribute, reconciled)
        if derived is not None:
            bundle.append(derived)
    return bundle


def source_health(session: Session) -> list[dict[str, Any]]:
    """Per-feed observed freshness — the input to degraded-mode decisions."""
    now = utcnow()
    out: list[dict[str, Any]] = []
    for feed in session.execute(select(SourceFeed).order_by(SourceFeed.key)).scalars().all():
        age = (
            (now - feed.last_success_at).total_seconds() / 60.0
            if feed.last_success_at is not None
            else None
        )
        out.append(
            {
                "key": feed.key,
                "description": feed.description,
                "owner": feed.owner,
                "extraction_method": feed.extraction_method,
                "criticality_tier": feed.criticality_tier,
                "contains_pii": feed.contains_pii,
                "freshness_sla_minutes": feed.freshness_sla_minutes,
                "last_success_at": feed.last_success_at,
                "last_failure_at": feed.last_failure_at,
                "last_failure_reason": feed.last_failure_reason,
                "age_minutes": None if age is None else round(age, 1),
                "state": "unobserved" if age is None else freshness_band(age, feed.key),
            }
        )
    return out


def staleness_report(session: Session, subject_id: int, *, subject_type: str = "entity") -> dict[str, Any]:
    reconciled = effective(session, subject_id, subject_type=subject_type)
    by_band: dict[str, list[str]] = {"fresh": [], "ageing": [], "stale": []}
    for attribute, fact in reconciled.items():
        by_band[fact.freshness].append(attribute)
    contested = {
        attribute: fact.conflicts for attribute, fact in reconciled.items() if fact.conflicts
    }
    return {
        "attributes": len(reconciled),
        "by_freshness": {band: sorted(items) for band, items in by_band.items()},
        "contested": contested,
        "degraded": bool(by_band["stale"]),
    }
