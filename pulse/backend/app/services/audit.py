"""The audit spine: one append-only, hash-chained log for every machine and human action."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AgentRun,
    AuditEvent,
    Decision,
    Fact,
    KnowledgeQuery,
    ScreeningHit,
    utcnow,
)

GENESIS = "0" * 64


def jsonable(value: Any) -> Any:
    """Coerce a payload into JSON primitives so the stored bytes are exactly the hashed bytes."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [jsonable(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _canonical(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def compute_hash(
    prev_hash: str,
    seq: int,
    actor: str,
    action: str,
    subject_type: str,
    subject_id: int | None,
    payload: dict[str, Any],
) -> str:
    material = "|".join(
        [prev_hash, str(seq), actor, action, subject_type, str(subject_id), _canonical(payload)]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def append(
    session: Session,
    *,
    actor: str,
    action: str,
    subject_type: str = "entity",
    subject_id: int | None = None,
    payload: dict[str, Any] | None = None,
    actor_role: str = "system",
) -> AuditEvent:
    last = session.execute(select(AuditEvent).order_by(AuditEvent.seq.desc()).limit(1)).scalar()
    seq = (last.seq + 1) if last else 1
    prev_hash = last.hash if last else GENESIS
    payload = {key: jsonable(value) for key, value in (payload or {}).items()}
    event = AuditEvent(
        seq=seq,
        ts=utcnow(),
        actor=actor,
        actor_role=actor_role,
        action=action,
        subject_type=subject_type,
        subject_id=subject_id,
        payload=payload,
        prev_hash=prev_hash,
        hash=compute_hash(prev_hash, seq, actor, action, subject_type, subject_id, payload),
    )
    session.add(event)
    session.flush()
    return event


def verify(session: Session) -> dict[str, Any]:
    """Recompute the chain and report the first divergence, if any."""
    events = session.execute(select(AuditEvent).order_by(AuditEvent.seq)).scalars().all()
    prev_hash = GENESIS
    for event in events:
        expected = compute_hash(
            prev_hash,
            event.seq,
            event.actor,
            event.action,
            event.subject_type,
            event.subject_id,
            event.payload,
        )
        if event.prev_hash != prev_hash or event.hash != expected:
            return {
                "valid": False,
                "events": len(events),
                "first_divergence_seq": event.seq,
                "expected_hash": expected,
                "stored_hash": event.hash,
            }
        prev_hash = event.hash
    return {"valid": True, "events": len(events), "head_hash": prev_hash}


def entity_timeline(session: Session, entity_id: int, limit: int = 200) -> list[dict[str, Any]]:
    """Everything that happened to an entity, in order — the Merchant 360 history panel.

    Matches both events about the entity itself and events about its cases, decisions, hits and
    agent runs, which carry ``entity_id`` in the payload.
    """
    events = session.execute(select(AuditEvent).order_by(AuditEvent.seq.desc())).scalars().all()
    timeline: list[dict[str, Any]] = []
    for event in events:
        relevant = (event.subject_type == "entity" and event.subject_id == entity_id) or (
            event.payload.get("entity_id") == entity_id
        )
        if not relevant:
            continue
        timeline.append(
            {
                "seq": event.seq,
                "ts": event.ts.isoformat(),
                "actor": event.actor,
                "actor_role": event.actor_role,
                "action": event.action,
                "subject_type": event.subject_type,
                "subject_id": event.subject_id,
                "payload": event.payload,
                "hash": event.hash,
            }
        )
        if len(timeline) >= limit:
            break
    return timeline


def export_entity_pack(session: Session, entity_id: int) -> dict[str, Any]:
    """Examiner-ready export: every fact, decision, recommendation and disposition in order."""

    def rows(model: Any, attr: str = "entity_id") -> list[dict[str, Any]]:
        stmt = select(model).where(getattr(model, attr) == entity_id)
        return [
            {c.name: getattr(row, c.name) for c in model.__table__.columns}
            for row in session.execute(stmt).scalars().all()
        ]

    facts = [
        {c.name: getattr(row, c.name) for c in Fact.__table__.columns}
        for row in session.execute(
            select(Fact).where(Fact.subject_type == "entity", Fact.subject_id == entity_id)
        )
        .scalars()
        .all()
    ]
    audit_rows = [
        {c.name: getattr(row, c.name) for c in AuditEvent.__table__.columns}
        for row in session.execute(
            select(AuditEvent)
            .where(AuditEvent.subject_id == entity_id)
            .order_by(AuditEvent.seq)
        )
        .scalars()
        .all()
    ]
    pack: dict[str, Any] = {
            "entity_id": entity_id,
            "generated_at": utcnow(),
            "chain_status": verify(session),
            "facts": facts,
            "screening_hits": rows(ScreeningHit),
            "decisions": rows(Decision),
            "agent_runs": rows(AgentRun),
            "audit_events": audit_rows,
            "knowledge_queries": [
                {c.name: getattr(row, c.name) for c in KnowledgeQuery.__table__.columns}
                for row in session.execute(select(KnowledgeQuery)).scalars().all()
            ],
    }
    return {key: jsonable(value) for key, value in pack.items()}
