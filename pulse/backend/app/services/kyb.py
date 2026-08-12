"""KYB: verify the applicant against source-of-truth registry data and build the graph.

The output that matters is not "verified: true" but the *disagreements*: which applicant-supplied
attribute conflicts with the registry, with both values and their provenance. That is what makes a
step-up review defensible instead of a re-keying exercise.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Entity, Fact, OwnershipEdge, Relationship
from app.providers import gateway
from app.services import audit, resolution
from app.services.resolution import normalise_name


@dataclass
class Mismatch:
    attribute: str
    applicant_value: str | None
    registry_value: str | None
    similarity: float
    severity: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "attribute": self.attribute,
            "applicant_value": self.applicant_value,
            "registry_value": self.registry_value,
            "similarity": round(self.similarity, 3),
            "severity": self.severity,
        }


@dataclass
class KYBResult:
    entity_id: int
    registry_found: bool
    registry_status: str | None
    verified_attributes: dict[str, Any] = field(default_factory=dict)
    mismatches: list[Mismatch] = field(default_factory=list)
    ownership_edges: int = 0
    relationships_created: list[str] = field(default_factory=list)
    unresolved_ownership_percentage: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "registry_found": self.registry_found,
            "registry_status": self.registry_status,
            "verified_attributes": self.verified_attributes,
            "mismatches": [m.as_dict() for m in self.mismatches],
            "ownership_edges": self.ownership_edges,
            "relationships_created": self.relationships_created,
            "unresolved_ownership_percentage": round(self.unresolved_ownership_percentage, 2),
        }


def record_fact(
    session: Session,
    *,
    subject_id: int,
    attribute: str,
    value: Any,
    source: str,
    confidence: float = 1.0,
    subject_type: str = "entity",
    as_of: dt.datetime | None = None,
) -> Fact:
    """Append a provenanced fact, superseding the previous value from the same source."""
    previous = session.execute(
        select(Fact)
        .where(
            Fact.subject_type == subject_type,
            Fact.subject_id == subject_id,
            Fact.attribute == attribute,
            Fact.source == source,
            Fact.superseded_by_id.is_(None),
        )
        .order_by(Fact.as_of.desc())
    ).scalars().first()

    fact = Fact(
        subject_type=subject_type,
        subject_id=subject_id,
        attribute=attribute,
        value=None if value is None else str(value),
        source=source,
        confidence=confidence,
        as_of=as_of or dt.datetime.now(dt.timezone.utc),
    )
    session.add(fact)
    session.flush()
    if previous is not None:
        previous.superseded_by_id = fact.id
    session.flush()
    return fact


def effective_facts(session: Session, entity_id: int) -> dict[str, dict[str, Any]]:
    """Current value per attribute, picking the highest confidence then most recent."""
    facts = session.execute(
        select(Fact).where(
            Fact.subject_type == "entity",
            Fact.subject_id == entity_id,
            Fact.superseded_by_id.is_(None),
        )
    ).scalars().all()
    effective: dict[str, dict[str, Any]] = {}
    for fact in facts:
        current = effective.get(fact.attribute)
        better = current is None or (fact.confidence, fact.as_of) > (
            current["confidence"],
            current["as_of"],
        )
        if better:
            effective[fact.attribute] = {
                "value": fact.value,
                "source": fact.source,
                "confidence": fact.confidence,
                "as_of": fact.as_of,
                "fact_id": fact.id,
            }
    return effective


def _upsert_related_entity(
    session: Session,
    *,
    name: str,
    entity_type: str,
    country: str | None,
    date_of_birth: str | None = None,
) -> Entity:
    normalised = normalise_name(name)
    for candidate in session.execute(
        select(Entity).where(Entity.entity_type == entity_type)
    ).scalars():
        if fuzz.token_set_ratio(normalised, normalise_name(candidate.legal_name)) / 100 >= 0.95:
            same_person = (
                entity_type != "person"
                or not date_of_birth
                or not candidate.date_of_birth
                or date_of_birth[:7] == candidate.date_of_birth[:7]
            )
            if not same_person:
                continue
            return candidate
    entity = Entity(
        entity_type=entity_type,
        legal_name=name,
        country=country,
        date_of_birth=date_of_birth,
    )
    session.add(entity)
    session.flush()
    return entity


def _upsert_ownership(
    session: Session,
    *,
    owner_id: int,
    owned_id: int,
    percentage: float,
    role: str | None,
    source: str,
    confidence: float,
) -> None:
    existing = session.execute(
        select(OwnershipEdge).where(
            OwnershipEdge.owner_entity_id == owner_id,
            OwnershipEdge.owned_entity_id == owned_id,
        )
    ).scalar()
    edge = existing or OwnershipEdge(owner_entity_id=owner_id, owned_entity_id=owned_id)
    edge.percentage = percentage
    edge.role = role
    edge.source = source
    edge.confidence = confidence
    session.add(edge)
    session.flush()


def _upsert_relationship(
    session: Session,
    *,
    from_id: int,
    to_id: int,
    rel_type: str,
    evidence: str,
    strength: float,
    source: str = "derived",
) -> bool:
    if from_id == to_id:
        return False
    existing = session.execute(
        select(Relationship).where(
            Relationship.from_entity_id.in_([from_id, to_id]),
            Relationship.to_entity_id.in_([from_id, to_id]),
            Relationship.rel_type == rel_type,
        )
    ).scalar()
    if existing is not None:
        return False
    session.add(
        Relationship(
            from_entity_id=from_id,
            to_entity_id=to_id,
            rel_type=rel_type,
            strength=strength,
            evidence=evidence,
            source=source,
        )
    )
    session.flush()
    return True


def verify(
    session: Session,
    entity_id: int,
    *,
    applicant: dict[str, Any] | None = None,
    actor: str = "system",
    depth: int = 2,
) -> KYBResult:
    """Pull registry, officer and ownership data; store as facts; expand the graph."""
    entity = session.get(Entity, entity_id)
    if entity is None:
        raise LookupError(f"unknown entity {entity_id}")
    applicant = applicant or {}
    params = {
        "country": entity.country,
        "registration_number": entity.registration_number,
        "legal_name": entity.legal_name,
    }

    company = gateway.call(
        session,
        provider="registry",
        operation="lookup_company",
        params=params,
        entity_id=entity_id,
        requested_by=actor,
    ).data
    result = KYBResult(
        entity_id=entity_id,
        registry_found=bool(company.get("found")),
        registry_status=company.get("status"),
    )
    if not company.get("found"):
        record_fact(
            session,
            subject_id=entity_id,
            attribute="kyb.registry_found",
            value=False,
            source="registry",
        )
        audit.append(
            session,
            actor=actor,
            action="kyb.registry_not_found",
            subject_id=entity_id,
            payload={"query": params},
        )
        return result

    for attribute, key in (
        ("registry.legal_name", "legal_name"),
        ("registry.status", "status"),
        ("registry.incorporated_on", "incorporated_on"),
        ("registry.registered_address", "registered_address"),
    ):
        record_fact(
            session,
            subject_id=entity_id,
            attribute=attribute,
            value=company.get(key),
            source="registry",
        )
    record_fact(
        session,
        subject_id=entity_id,
        attribute="registry.sic_codes",
        value=",".join(company.get("sic_codes") or []),
        source="registry",
    )
    result.verified_attributes = {
        "legal_name": company["legal_name"],
        "status": company["status"],
        "incorporated_on": company["incorporated_on"],
        "registered_address": company["registered_address"],
        "sic_codes": company.get("sic_codes"),
        "fca_authorised": bool(company.get("fca_authorised", False)),
        "hmrc_msb_registered": bool(company.get("hmrc_msb_registered", False)),
    }
    entity.address = entity.address or company["registered_address"]

    officers = gateway.call(
        session,
        provider="registry",
        operation="lookup_officers",
        params=params,
        entity_id=entity_id,
        requested_by=actor,
    ).data.get("officers", [])
    ownership = gateway.call(
        session,
        provider="registry",
        operation="lookup_ownership",
        params=params,
        entity_id=entity_id,
        requested_by=actor,
    ).data.get("ownership", [])

    # ---- disagreements between applicant claims and the registry -------------------------
    if applicant.get("legal_name"):
        similarity = (
            fuzz.token_set_ratio(
                normalise_name(applicant["legal_name"]), normalise_name(company["legal_name"])
            )
            / 100
        )
        if similarity < 0.95:
            result.mismatches.append(
                Mismatch(
                    "legal_name",
                    applicant["legal_name"],
                    company["legal_name"],
                    similarity,
                    "high" if similarity < 0.7 else "medium",
                )
            )
    if applicant.get("address"):
        similarity = (
            fuzz.token_set_ratio(
                applicant["address"].lower(), company["registered_address"].lower()
            )
            / 100
        )
        if similarity < 0.8:
            result.mismatches.append(
                Mismatch("address", applicant["address"], company["registered_address"], similarity, "medium")
            )
    if applicant.get("director_name"):
        best = max(
            (
                fuzz.token_set_ratio(
                    normalise_name(applicant["director_name"]), normalise_name(o["name"])
                )
                / 100
                for o in officers
            ),
            default=0.0,
        )
        if best < 0.9:
            result.mismatches.append(
                Mismatch(
                    "director_name",
                    applicant["director_name"],
                    ", ".join(o["name"] for o in officers) or None,
                    best,
                    "high" if best < 0.6 else "medium",
                )
            )
    if company["status"] != "active":
        result.mismatches.append(
            Mismatch("registry_status", "active (implied by application)", company["status"], 0.0, "critical")
        )

    # ---- officers → graph ----------------------------------------------------------------
    for officer in officers:
        person = _upsert_related_entity(
            session,
            name=officer["name"],
            entity_type="person",
            country=entity.country,
            date_of_birth=officer.get("dob"),
        )
        _upsert_relationship(
            session,
            from_id=person.id,
            to_id=entity_id,
            rel_type="officer_of",
            evidence=f"{officer.get('role', 'officer')} per {entity.country} registry",
            strength=0.9,
            source="registry",
        )
        # Any other company with the same officer is a shared-director link.
        for other in session.execute(
            select(Relationship).where(
                Relationship.from_entity_id == person.id, Relationship.rel_type == "officer_of"
            )
        ).scalars():
            if other.to_entity_id != entity_id:
                _upsert_relationship(
                    session,
                    from_id=entity_id,
                    to_id=other.to_entity_id,
                    rel_type="shared_director",
                    evidence=f"both companies list {officer['name']} as an officer",
                    strength=0.85,
                    source="registry",
                )

    # ---- shared registered address → graph ----------------------------------------------
    address = (company["registered_address"] or "").lower()
    if address:
        for peer in session.execute(select(Entity).where(Entity.id != entity_id)).scalars():
            if peer.address and fuzz.token_set_ratio(address, peer.address.lower()) / 100 >= 0.92:
                _upsert_relationship(
                    session,
                    from_id=entity_id,
                    to_id=peer.id,
                    rel_type="shared_address",
                    evidence=f"shared registered address: {company['registered_address']}",
                    strength=0.6,
                    source="registry",
                )

    # ---- ownership → graph, recursively --------------------------------------------------
    declared = 0.0
    for holder in ownership:
        declared += float(holder.get("percentage") or 0.0)
        if holder.get("type") == "company":
            child_lookup = gateway.call(
                session,
                provider="registry",
                operation="lookup_company",
                params={"legal_name": holder["name"]},
                entity_id=entity_id,
                requested_by=actor,
            ).data
            if child_lookup.get("found"):
                owner_result = resolution.resolve(
                    session,
                    source_system="registry",
                    source_ref=f"{child_lookup['country']}:{child_lookup['registration_number']}",
                    payload={
                        "legal_name": child_lookup["legal_name"],
                        "country": child_lookup["country"],
                        "registration_number": child_lookup["registration_number"],
                        "address": child_lookup["registered_address"],
                        "entity_type": "company",
                    },
                    actor=actor,
                )
                owner = session.get(Entity, owner_result.entity_id)
            else:
                owner = _upsert_related_entity(
                    session,
                    name=holder["name"],
                    entity_type="company",
                    country=entity.country,
                )
        else:
            owner = _upsert_related_entity(
                session,
                name=holder["name"],
                entity_type="person",
                country=entity.country,
            )
        assert owner is not None
        _upsert_ownership(
            session,
            owner_id=owner.id,
            owned_id=entity_id,
            percentage=float(holder.get("percentage") or 0.0),
            role=holder.get("role") or "shareholder",
            source="registry",
            confidence=0.95,
        )
        result.ownership_edges += 1
        if owner.entity_type == "company" and depth > 1:
            verify(session, owner.id, actor=actor, depth=depth - 1)

    result.unresolved_ownership_percentage = max(0.0, 100.0 - declared)
    session.flush()

    result.relationships_created = sorted(
        {
            rel.rel_type
            for rel in session.execute(
                select(Relationship).where(
                    (Relationship.from_entity_id == entity_id)
                    | (Relationship.to_entity_id == entity_id)
                )
            ).scalars()
        }
    )
    audit.append(
        session,
        actor=actor,
        action="kyb.verified",
        subject_id=entity_id,
        payload={
            "registry_status": company["status"],
            "mismatches": [m.as_dict() for m in result.mismatches],
            "ownership_edges": result.ownership_edges,
            "unresolved_ownership_percentage": result.unresolved_ownership_percentage,
        },
    )
    return result
