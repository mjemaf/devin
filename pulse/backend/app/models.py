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
    """A provenanced attribute about a subject. Conflicts coexist; the winner is explainable."""

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
    resolution: Mapped[str | None] = mapped_column(String(255), default=None)
    closed_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, default=None)
    created_at: Mapped[dt.datetime] = mapped_column(UTCDateTime, default=utcnow)


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
