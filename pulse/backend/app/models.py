"""Canonical PULSE data model.

Design notes that matter more than the columns:

* Externally sourced or derived attributes are stored as :class:`Fact` rows carrying source,
  confidence and ``as_of`` rather than as mutable columns, so conflicting sources coexist and the
  effective value is explainable ("continuously reconciled").
* Knowledge is effective-dated (:class:`DocumentVersion`), so the rule in force at any past date
  is retrievable and any decision is replayable.
* Every machine or human action lands in :class:`AuditEvent`, a single hash-chained log. There is
  no per-capability audit table.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class UTCDateTime(TypeDecorator[dt.datetime]):
    """Timestamps are always UTC-aware in Python, whatever the backend stores.

    SQLite drops the offset, and effective-dating compares stored timestamps against ``utcnow()``
    constantly, so a naive round-trip would break every as-of query.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: dt.datetime | None, dialect: Any) -> dt.datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=dt.timezone.utc)
        return value.astimezone(dt.timezone.utc)

    def process_result_value(self, value: dt.datetime | None, dialect: Any) -> dt.datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value


class Base(DeclarativeBase):
    pass


# --------------------------------------------------------------------------------------
# Entity & merchant intelligence
# --------------------------------------------------------------------------------------


class Entity(Base):
    """A resolved legal entity or natural person — the unit of analysis for all risk."""

    __tablename__ = "entities"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(16), default="company")  # company | person
    legal_name: Mapped[str] = mapped_column(String(255))
    trading_name: Mapped[str | None] = mapped_column(String(255), default=None)
    country: Mapped[str | None] = mapped_column(String(2), default=None)
    registration_number: Mapped[str | None] = mapped_column(String(64), default=None)
    website: Mapped[str | None] = mapped_column(String(255), default=None)
    address: Mapped[str | None] = mapped_column(String(255), default=None)
    date_of_birth: Mapped[str | None] = mapped_column(String(16), default=None)
    status: Mapped[str] = mapped_column(String(24), default="active")  # active | offboarded
    offboarded_reason: Mapped[str | None] = mapped_column(String(255), default=None)
    resolution_confidence: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)

    merchants: Mapped[list[Merchant]] = relationship(back_populates="entity")


class Merchant(Base):
    """A commercial relationship with a resolved entity, across its lifecycle."""

    __tablename__ = "merchants"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    segment: Mapped[str] = mapped_column(String(32), default="smb")  # smb | mid | enterprise
    region: Mapped[str] = mapped_column(String(16), default="EU")
    mcc: Mapped[str | None] = mapped_column(String(8), default=None)
    business_model: Mapped[str | None] = mapped_column(String(64), default=None)
    underwritten_mcc: Mapped[str | None] = mapped_column(String(8), default=None)
    underwritten_business_model: Mapped[str | None] = mapped_column(String(64), default=None)
    lifecycle_state: Mapped[str] = mapped_column(String(24), default="intake")
    monthly_volume: Mapped[float] = mapped_column(Float, default=0.0)
    # Volume stated at application: the denominator for declared-versus-observed drift.
    declared_volume: Mapped[float] = mapped_column(Float, default=0.0)
    # Acquiring/gateway identifier the transaction streams arrive under (PLS-16 resolution key).
    platform_mid: Mapped[str | None] = mapped_column(String(48), default=None, index=True)
    chargeback_rate: Mapped[float] = mapped_column(Float, default=0.0)
    reserve_held: Mapped[float] = mapped_column(Float, default=0.0)
    credit_limit: Mapped[float] = mapped_column(Float, default=0.0)
    boarded_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    terminated_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    review_cadence_days: Mapped[int] = mapped_column(Integer, default=365)
    last_reviewed_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)

    entity: Mapped[Entity] = relationship(back_populates="merchants")


class SourceRecord(Base):
    """A raw inbound record from a source system, before resolution.

    Kept forever: resolution lineage is only auditable if the pre-resolution view survives.
    """

    __tablename__ = "source_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_system: Mapped[str] = mapped_column(String(64))
    source_ref: Mapped[str] = mapped_column(String(128))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    resolved_entity_id: Mapped[int | None] = mapped_column(
        ForeignKey("entities.id"), default=None, index=True
    )
    match_confidence: Mapped[float | None] = mapped_column(Float, default=None)
    match_method: Mapped[str | None] = mapped_column(String(64), default=None)
    match_contributions: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    review_required: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("source_system", "source_ref", name="uq_source_ref"),)


class Fact(Base):
    """A provenanced, bi-temporal attribute about a subject.

    ``valid_from``/``valid_to`` carry world time (when the assertion was true of the world) and
    ``recorded_at``/``superseded_at`` carry system time (when Pulse came to believe it). Conflicts
    coexist: ``conflict_set`` names the competing fact ids and ``resolution_rule`` the rule that
    picked the effective value, so a citation can always say why one source won.
    """

    __tablename__ = "facts"

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_type: Mapped[str] = mapped_column(String(32), default="entity")
    subject_id: Mapped[int] = mapped_column(Integer, index=True)
    attribute: Mapped[str] = mapped_column(String(96), index=True)
    value: Mapped[str | None] = mapped_column(Text, default=None)
    source: Mapped[str] = mapped_column(String(64))
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    as_of: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    superseded_by_id: Mapped[int | None] = mapped_column(ForeignKey("facts.id"), default=None)
    valid_from: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    valid_to: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    recorded_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    superseded_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    extraction_method: Mapped[str] = mapped_column(String(32), default="api")
    source_ref: Mapped[str | None] = mapped_column(String(128), default=None)
    content_hash: Mapped[str | None] = mapped_column(String(64), default=None)
    classification: Mapped[str] = mapped_column(String(24), default="internal")
    conflict_set: Mapped[list[int]] = mapped_column(JSON, default=list)
    resolution_rule: Mapped[str | None] = mapped_column(String(64), default=None)


class OwnershipEdge(Base):
    """A single ownership link. The UBO graph is the transitive closure of these."""

    __tablename__ = "ownership_edges"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    owned_entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    percentage: Mapped[float] = mapped_column(Float, default=0.0)
    role: Mapped[str | None] = mapped_column(String(64), default=None)
    source: Mapped[str] = mapped_column(String(64), default="registry")
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    as_of: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Asserted → Corroborated → Disputed → Superseded, per the canonical OwnershipEdge lifecycle.
    state: Mapped[str] = mapped_column(String(16), default="asserted")
    basis: Mapped[str | None] = mapped_column(String(64), default=None)
    valid_from: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    valid_to: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    conflict_set: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)


class Relationship(Base):
    """A non-ownership link between entities — the substrate for network/link analysis."""

    __tablename__ = "relationships"

    id: Mapped[int] = mapped_column(primary_key=True)
    from_entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    to_entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    rel_type: Mapped[str] = mapped_column(String(48))
    strength: Mapped[float] = mapped_column(Float, default=0.5)
    evidence: Mapped[str | None] = mapped_column(Text, default=None)
    source: Mapped[str] = mapped_column(String(64), default="internal")
    as_of: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


# --------------------------------------------------------------------------------------
# Knowledge & policy
# --------------------------------------------------------------------------------------


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(String(255))
    doc_type: Mapped[str] = mapped_column(String(48))  # policy | regulation | scheme_rule | sop
    jurisdiction: Mapped[str] = mapped_column(String(16), default="global")
    owner: Mapped[str | None] = mapped_column(String(96), default=None)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)

    versions: Mapped[list[DocumentVersion]] = relationship(back_populates="document")


class DocumentVersion(Base):
    __tablename__ = "document_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|approved|retired
    effective_from: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    effective_to: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    text: Mapped[str] = mapped_column(Text)
    checksum: Mapped[str] = mapped_column(String(64))
    approved_by: Mapped[str | None] = mapped_column(String(96), default=None)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)

    document: Mapped[Document] = relationship(back_populates="versions")
    chunks: Mapped[list[Chunk]] = relationship(back_populates="document_version")


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer, default=0)
    heading: Mapped[str | None] = mapped_column(String(255), default=None)
    text: Mapped[str] = mapped_column(Text)

    document_version: Mapped[DocumentVersion] = relationship(back_populates="chunks")


class EvidenceDocument(Base):
    """Merchant-supplied or generated evidence (financials, incorporation, notices)."""

    __tablename__ = "evidence_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"), default=None)
    doc_type: Mapped[str] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(255))
    text: Mapped[str | None] = mapped_column(Text, default=None)
    contains_pii: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    legal_hold: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(64), default="merchant_upload")
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class KnowledgeQuery(Base):
    """Every grounded question, its retrievals and outcome — including refusals.

    Refusals are the knowledge-gap backlog: the feedback loop the Northstar deck asks for.
    """

    __tablename__ = "knowledge_queries"

    id: Mapped[int] = mapped_column(primary_key=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    grounded: Mapped[bool] = mapped_column(Boolean, default=True)
    top_score: Mapped[float] = mapped_column(Float, default=0.0)
    citations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    as_of: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    asked_by: Mapped[str] = mapped_column(String(96), default="unknown")
    feedback: Mapped[str | None] = mapped_column(String(24), default=None)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


# --------------------------------------------------------------------------------------
# Screening, scoring, decisioning
# --------------------------------------------------------------------------------------


class ScreeningListEntry(Base):
    __tablename__ = "screening_list_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    list_name: Mapped[str] = mapped_column(String(48), index=True)
    name: Mapped[str] = mapped_column(String(255))
    country: Mapped[str | None] = mapped_column(String(2), default=None)
    date_of_birth: Mapped[str | None] = mapped_column(String(16), default=None)
    programme: Mapped[str | None] = mapped_column(String(96), default=None)
    entry_type: Mapped[str] = mapped_column(String(16), default="person")
    added_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class ScreeningHit(Base):
    __tablename__ = "screening_hits"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    # The screened subject may be an owner/officer rather than the merchant entity itself.
    subject_entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    list_type: Mapped[str] = mapped_column(String(32), index=True)
    list_name: Mapped[str | None] = mapped_column(String(96), default=None)
    matched_name: Mapped[str] = mapped_column(String(255))
    programme: Mapped[str | None] = mapped_column(String(96), default=None)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    score_components: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    demotions: Mapped[list[str]] = mapped_column(JSON, default=list)
    detail: Mapped[str | None] = mapped_column(Text, default=None)
    disposition: Mapped[str] = mapped_column(String(24), default="potential_match")
    review_rationale: Mapped[str | None] = mapped_column(Text, default=None)
    reviewed_by: Mapped[str | None] = mapped_column(String(96), default=None)
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    trigger: Mapped[str] = mapped_column(String(48), default="onboarding")
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class Score(Base):
    """A reproducible score: inputs hash + contributions + as_of make it explainable."""

    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    model_key: Mapped[str] = mapped_column(String(64))
    model_version: Mapped[str] = mapped_column(String(16), default="1")
    value: Mapped[float] = mapped_column(Float)
    band: Mapped[str] = mapped_column(String(16))
    peer_percentile: Mapped[float | None] = mapped_column(Float, default=None)
    contributions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    features: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    inputs_hash: Mapped[str] = mapped_column(String(64))
    as_of: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    decision_type: Mapped[str] = mapped_column(String(48))
    outcome: Mapped[str] = mapped_column(String(32))
    policy_pack: Mapped[str] = mapped_column(String(48))
    policy_version: Mapped[str] = mapped_column(String(16))
    rule_results: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    reason_codes: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    counterfactuals: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    materiality: Mapped[str] = mapped_column(String(16), default="low")
    required_oversight: Mapped[str] = mapped_column(String(24), default="four_eyes")
    actor: Mapped[str] = mapped_column(String(96), default="system")
    agent_run_id: Mapped[int | None] = mapped_column(ForeignKey("agent_runs.id"), default=None)
    as_of: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Immutable on write. The fields below make the decision replayable and attributable: the exact
    # fact set relied on, the models consulted, the jurisdiction and the accountable human.
    jurisdiction: Mapped[str] = mapped_column(String(16), default="global")
    facts_relied: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    fact_provenance: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    model_versions: Mapped[list[str]] = mapped_column(JSON, default=list)
    accountable_party: Mapped[str | None] = mapped_column(String(96), default=None)
    accountable_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    degraded_checks: Mapped[list[str]] = mapped_column(JSON, default=list)


# --------------------------------------------------------------------------------------
# Perpetual monitoring
# --------------------------------------------------------------------------------------


class Monitor(Base):
    __tablename__ = "monitors"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    description: Mapped[str] = mapped_column(String(255))
    cadence_days: Mapped[int | None] = mapped_column(Integer, default=None)
    event_triggers: Mapped[list[str]] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    monitor_key: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium")
    title: Mapped[str] = mapped_column(String(255))
    detail: Mapped[str] = mapped_column(Text, default="")
    signals: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="open")
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), default=None)
    # A recurring signal is folded into the open alert; recurrence is itself risk information, so it
    # is counted rather than discarded.
    occurrences: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_seen_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


# --------------------------------------------------------------------------------------
# Cases
# --------------------------------------------------------------------------------------


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    case_type: Mapped[str] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(24), default="open")
    severity: Mapped[str] = mapped_column(String(16), default="medium")
    assignee: Mapped[str | None] = mapped_column(String(96), default=None)
    created_by: Mapped[str] = mapped_column(String(96), default="system")
    sla_due_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    # Mandatory at close (PLS-52): confirmed | false_positive | explained.
    disposition: Mapped[str | None] = mapped_column(String(24), default=None)
    resolution: Mapped[str | None] = mapped_column(String(255), default=None)
    closed_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class Requirement(Base):
    """An outstanding information or document requirement (PLS-54).

    A requirement carries a due date and a *declared consequence*, so an unmet ask has a defined
    effect (boarding blocked, credit frozen, restriction) rather than ageing quietly in an inbox.
    """

    __tablename__ = "requirements"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), default=None, index=True)
    requirement_type: Mapped[str] = mapped_column(String(64), index=True)
    accepted_evidence: Mapped[list[str]] = mapped_column(JSON, default=list)
    state: Mapped[str] = mapped_column(String(16), default="outstanding")
    consequence: Mapped[str] = mapped_column(String(32), default="restriction")
    requested_by: Mapped[str] = mapped_column(String(96), default="system")
    rationale: Mapped[str] = mapped_column(Text, default="")
    due_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    satisfied_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    satisfied_by: Mapped[str | None] = mapped_column(String(96), default=None)
    escalated_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    evidence_id: Mapped[int | None] = mapped_column(
        ForeignKey("evidence_documents.id"), default=None
    )


class CaseEvent(Base):
    __tablename__ = "case_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    actor: Mapped[str] = mapped_column(String(96))
    action: Mapped[str] = mapped_column(String(48))
    note: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


# --------------------------------------------------------------------------------------
# Agent oversight (AOF)
# --------------------------------------------------------------------------------------


class ARP(Base):
    """Automated Resolution Pathway: agent x task x SOP x data scope x success criteria."""

    __tablename__ = "arps"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    task: Mapped[str] = mapped_column(String(255))
    sop_refs: Mapped[list[str]] = mapped_column(JSON, default=list)
    data_contract: Mapped[list[str]] = mapped_column(JSON, default=list)
    success_criteria: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    permitted_recommendations: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Which platform capabilities the pathway may invoke; everything else is denied.
    tool_scope: Mapped[list[str]] = mapped_column(JSON, default=list)
    prompt_version: Mapped[str] = mapped_column(String(32), default="v1")
    model_binding: Mapped[str | None] = mapped_column(String(64), default=None)
    escalation_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    owner: Mapped[str | None] = mapped_column(String(96), default=None)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    autonomy_tier: Mapped[str] = mapped_column(String(16), default="shadow")
    autonomy_ceiling: Mapped[str] = mapped_column(String(16), default="four_eyes")
    kill_switch_engaged: Mapped[bool] = mapped_column(Boolean, default=False)
    validated_by: Mapped[str | None] = mapped_column(String(96), default=None)
    validated_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    tier_history: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    arp_key: Mapped[str] = mapped_column(String(64), index=True)
    arp_version: Mapped[int] = mapped_column(Integer, default=1)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), default=None)
    mode: Mapped[str] = mapped_column(String(16), default="shadow")
    recommendation: Mapped[str] = mapped_column(String(48))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    rationale: Mapped[str] = mapped_column(Text, default="")
    citations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    decision_path: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    features: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    data_accessed: Mapped[list[str]] = mapped_column(JSON, default=list)
    models_consulted: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="pending_review")
    requested_by: Mapped[str | None] = mapped_column(String(96), default=None)
    reviewer: Mapped[str | None] = mapped_column(String(96), default=None)
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    review_note: Mapped[str | None] = mapped_column(Text, default=None)
    second_approver: Mapped[str | None] = mapped_column(String(96), default=None)
    human_outcome: Mapped[str | None] = mapped_column(String(48), default=None)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class ProviderCall(Base):
    """Third-party gateway metering: cost attribution and cache effectiveness per call."""

    __tablename__ = "provider_calls"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(48), index=True)
    operation: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"), default=None)
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    requested_by: Mapped[str] = mapped_column(String(96), default="system")
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class PlatformEvent(Base):
    """A durable canonical event on the fabric (PLS-13).

    Publishing is the contract between components: nothing calls a peer synchronously to tell it
    something happened. Topics are versioned (``{env}.risk.{domain}.{entity}.{version}``) and every
    record keeps both occurrence and record time so a consumer can be replayed from any point.
    """

    __tablename__ = "platform_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    topic: Mapped[str] = mapped_column(String(96), index=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    producer: Mapped[str] = mapped_column(String(64), default="pulse")
    subject_type: Mapped[str] = mapped_column(String(32), default="entity")
    subject_id: Mapped[int | None] = mapped_column(Integer, default=None, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    recorded_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    handlers_invoked: Mapped[int] = mapped_column(Integer, default=0)
    retention_days: Mapped[int] = mapped_column(Integer, default=2557)  # 7 years


class SourceFeed(Base):
    """A registered inbound source with an owner, a freshness SLA and observed state (PLS-10/14).

    A feed that misses its SLA marks derived facts stale; consumers surface staleness rather than
    silently serving old data.
    """

    __tablename__ = "source_feeds"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(48), unique=True)
    description: Mapped[str] = mapped_column(String(255), default="")
    owner: Mapped[str] = mapped_column(String(96), default="platform")
    extraction_method: Mapped[str] = mapped_column(String(32), default="api")
    freshness_sla_minutes: Mapped[int] = mapped_column(Integer, default=1440)
    criticality_tier: Mapped[int] = mapped_column(Integer, default=2)
    residency: Mapped[str] = mapped_column(String(16), default="global")
    contains_pii: Mapped[bool] = mapped_column(Boolean, default=False)
    last_success_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    last_failure_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    last_failure_reason: Mapped[str | None] = mapped_column(String(255), default=None)


class ModelArtefact(Base):
    """An SR 11-7 registry entry for a model, rule set, prompt or agent (PLS-71).

    Nothing runs through the AI gateway or the ARP executor without a registry entry in
    ``validated`` state — the control is code, not process.
    """

    __tablename__ = "model_artefacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[str] = mapped_column(String(16), default="1")
    artefact_type: Mapped[str] = mapped_column(String(24), default="model")
    purpose: Mapped[str] = mapped_column(String(255), default="")
    owner: Mapped[str] = mapped_column(String(96), default="model.risk@pulse.example")
    approved_use: Mapped[list[str]] = mapped_column(JSON, default=list)
    limitations: Mapped[list[str]] = mapped_column(JSON, default=list)
    training_data_ref: Mapped[str | None] = mapped_column(String(255), default=None)
    feature_set: Mapped[list[str]] = mapped_column(JSON, default=list)
    bias_exposure: Mapped[str | None] = mapped_column(String(255), default=None)
    fair_lending_relevant: Mapped[bool] = mapped_column(Boolean, default=False)
    validation_evidence: Mapped[str | None] = mapped_column(Text, default=None)
    validated_by: Mapped[str | None] = mapped_column(String(96), default=None)
    validated_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    monitoring_plan: Mapped[str | None] = mapped_column(Text, default=None)
    revalidation_due: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    residency: Mapped[str] = mapped_column(String(16), default="global")
    barred_classifications: Mapped[list[str]] = mapped_column(JSON, default=list)
    state: Mapped[str] = mapped_column(String(16), default="draft")
    change_history: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)

    __table_args__ = (UniqueConstraint("key", "version", name="uq_artefact_version"),)


class ModelInvocation(Base):
    """Every model call that left through the AI gateway (PLS-80), priced and attributed."""

    __tablename__ = "model_invocations"

    id: Mapped[int] = mapped_column(primary_key=True)
    artefact_key: Mapped[str] = mapped_column(String(64), index=True)
    artefact_version: Mapped[str] = mapped_column(String(16), default="1")
    purpose: Mapped[str] = mapped_column(String(64))
    caller: Mapped[str] = mapped_column(String(96), default="system")
    arp_key: Mapped[str | None] = mapped_column(String(64), default=None)
    use_case: Mapped[str] = mapped_column(String(48), default="unassigned")
    prompt_version: Mapped[str] = mapped_column(String(32), default="v1")
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"), default=None)
    context_manifest_hash: Mapped[str | None] = mapped_column(String(64), default=None)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[str] = mapped_column(String(24), default="ok")
    detail: Mapped[str | None] = mapped_column(String(255), default=None)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class ApprovalRequest(Base):
    """Four-eyes as a platform primitive (PLS-72), not a per-use-case implementation."""

    __tablename__ = "approval_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_type: Mapped[str] = mapped_column(String(32))
    subject_id: Mapped[int | None] = mapped_column(Integer, default=None, index=True)
    decision_class: Mapped[str] = mapped_column(String(48))
    action: Mapped[str] = mapped_column(String(48))
    severity: Mapped[str] = mapped_column(String(16), default="medium")
    proposer: Mapped[str] = mapped_column(String(96))
    proposer_role: Mapped[str] = mapped_column(String(32), default="analyst")
    required_role: Mapped[str] = mapped_column(String(32), default="approver")
    state: Mapped[str] = mapped_column(String(16), default="pending")
    approver: Mapped[str | None] = mapped_column(String(96), default=None)
    rationale: Mapped[str | None] = mapped_column(Text, default=None)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    decided_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)


class BrokeredAction(Base):
    """The single record of every consequential action taken on the outside world (PLS-53)."""

    __tablename__ = "brokered_actions"

    id: Mapped[int] = mapped_column(primary_key=True)
    action_type: Mapped[str] = mapped_column(String(48), index=True)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"), default=None, index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), default=None)
    actor: Mapped[str] = mapped_column(String(96))
    actor_type: Mapped[str] = mapped_column(String(16), default="human")  # human | agent
    authority_basis: Mapped[str] = mapped_column(String(96))
    rule_ref: Mapped[str | None] = mapped_column(String(64), default=None)
    rule_version: Mapped[str | None] = mapped_column(String(16), default=None)
    approval_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("approval_requests.id"), default=None
    )
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    state: Mapped[str] = mapped_column(String(16), default="executed")
    rollback_token: Mapped[str | None] = mapped_column(String(36), default=None)
    reversible: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    rolled_back_by: Mapped[str | None] = mapped_column(String(96), default=None)
    rolled_back_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    prior_state: Mapped[str | None] = mapped_column(String(24), default=None)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class OutcomeLabel(Base):
    """A labelled outcome closing the loop back to evaluation and knowledge curation (PLS-52)."""

    __tablename__ = "outcome_labels"

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_type: Mapped[str] = mapped_column(String(32), index=True)
    subject_id: Mapped[int] = mapped_column(Integer, index=True)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id"), default=None, index=True)
    label: Mapped[str] = mapped_column(String(24))  # confirmed | false_positive | explained
    exit_classification: Mapped[str | None] = mapped_column(String(16), default=None)
    predicted: Mapped[str | None] = mapped_column(String(48), default=None)
    observed: Mapped[str | None] = mapped_column(String(48), default=None)
    arp_key: Mapped[str | None] = mapped_column(String(64), default=None, index=True)
    note: Mapped[str | None] = mapped_column(Text, default=None)
    labelled_by: Mapped[str] = mapped_column(String(96), default="system")
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


class TransactionEvent(Base):
    """A transaction normalised to the canonical model before detection sees it (PLS-16)."""

    __tablename__ = "transaction_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    dedupe_key: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    merchant_id: Mapped[int] = mapped_column(ForeignKey("merchants.id"), index=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)
    source_platform: Mapped[str] = mapped_column(String(48), default="acquiring")
    event_type: Mapped[str] = mapped_column(String(32), default="authorisation")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    amount_base: Mapped[float] = mapped_column(Float, default=0.0)
    channel: Mapped[str | None] = mapped_column(String(24), default=None)
    country: Mapped[str | None] = mapped_column(String(2), default=None)
    mcc: Mapped[str | None] = mapped_column(String(8), default=None)
    occurred_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    normalised_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    normalisation_ms: Mapped[int] = mapped_column(Integer, default=0)
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Experiment(Base):
    """A registered champion/challenger, shadow or holdout experiment (PLS-85)."""

    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    hypothesis: Mapped[str] = mapped_column(Text)
    scope: Mapped[str] = mapped_column(String(255), default="portfolio")
    mode: Mapped[str] = mapped_column(String(24), default="shadow")
    control: Mapped[str] = mapped_column(String(96), default="incumbent")
    variant: Mapped[str] = mapped_column(String(96), default="challenger")
    metric: Mapped[str] = mapped_column(String(96), default="agreement_rate")
    guardrail_metric: Mapped[str] = mapped_column(String(96), default="false_positive_rate")
    min_observations: Mapped[int] = mapped_column(Integer, default=50)
    observations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    owner: Mapped[str] = mapped_column(String(96), default="risk.owner@pulse.example")
    state: Mapped[str] = mapped_column(String(16), default="shadow")
    result: Mapped[str | None] = mapped_column(Text, default=None)
    adopted: Mapped[bool | None] = mapped_column(Boolean, default=None)
    started_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    concluded_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)


class AuditEvent(Base):
    """Append-only, hash-chained. The only audit trail in the platform."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    ts: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)
    actor: Mapped[str] = mapped_column(String(96))
    actor_role: Mapped[str] = mapped_column(String(32), default="system")
    action: Mapped[str] = mapped_column(String(64), index=True)
    subject_type: Mapped[str] = mapped_column(String(32), default="entity")
    subject_id: Mapped[int | None] = mapped_column(Integer, default=None, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
