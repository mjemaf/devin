"""PLS-13 event fabric: durable, versioned canonical topics with idempotent replay.

Two things matter here beyond delivery:

* **Durability.** Every publish is recorded as a :class:`~app.models.PlatformEvent` before handlers
  run, so a consumer can be rebuilt from the log rather than from whatever it happened to see live.
  Swapping the in-process broker for Kafka/PubSub is an adapter change: the topic names, schemas and
  handler signature are the contract.
* **Schema enforcement.** Topics are versioned ``risk.{domain}.{entity}.v{n}`` and carry a declared
  required payload shape. Publishing something that does not match is a programming error and fails
  loudly rather than poisoning downstream consumers. New fields are additive; a breaking change is a
  new topic version.

Internal event *names* (``screening.list_updated`` and friends) predate the canonical topic register
and remain the subscription key, because ``Monitor.event_triggers`` and the API refer to them. Each
one maps to a canonical topic below, which is what gets recorded and replayed.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PlatformEvent, utcnow


@dataclass(frozen=True)
class Event:
    name: str
    subject_type: str
    subject_id: int | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    occurred_at: dt.datetime | None = None
    producer: str = "pulse"
    event_id: str | None = None


Handler = Callable[[Session, Event], None]


class SchemaError(ValueError):
    """A publish that does not satisfy the registered topic schema."""


# --- canonical topics ----------------------------------------------------------------------

ENTITY_RESOLVED = "risk.entity.resolved.v1"
OWNERSHIP_CHANGED = "risk.ownership.changed.v1"
KNOWLEDGE_UPDATED = "risk.knowledge.updated.v1"
POLICY_VERSION_PUBLISHED = "risk.policy.version.published.v1"
SIGNAL_RAISED = "risk.signal.raised.v1"
ASSESSMENT_COMPLETED = "risk.assessment.completed.v1"
DECISION_RECORDED = "risk.decision.recorded.v1"
CASE_LIFECYCLE = "risk.case.lifecycle.v1"
SCREENING_HIT = "risk.screening.hit.v1"
MONITORING_REFRESH = "risk.monitoring.refresh.v1"
TRANSACTION_NORMALISED = "risk.transaction.normalised.v1"
ACTION_EXECUTED = "risk.action.executed.v1"
OUTCOME_LABELLED = "risk.outcome.labelled.v1"

# Retention is the longest applicable obligation for the topic's subject matter, in days.
_SEVEN_YEARS = 2557
_TEN_YEARS = 3653

TOPICS: dict[str, dict[str, Any]] = {
    ENTITY_RESOLVED: {"required": ("entity_id",), "retention_days": _SEVEN_YEARS},
    OWNERSHIP_CHANGED: {"required": ("entity_id",), "retention_days": _SEVEN_YEARS},
    KNOWLEDGE_UPDATED: {"required": ("document_key", "version"), "retention_days": _SEVEN_YEARS},
    POLICY_VERSION_PUBLISHED: {"required": ("pack", "version"), "retention_days": _TEN_YEARS},
    SIGNAL_RAISED: {"required": ("entity_id", "monitor_key", "severity"), "retention_days": _SEVEN_YEARS},
    ASSESSMENT_COMPLETED: {"required": ("entity_id", "outcome"), "retention_days": _SEVEN_YEARS},
    DECISION_RECORDED: {"required": ("entity_id", "decision_type", "outcome"), "retention_days": _TEN_YEARS},
    CASE_LIFECYCLE: {"required": ("case_id", "state"), "retention_days": _SEVEN_YEARS},
    SCREENING_HIT: {"required": ("entity_id", "list_type"), "retention_days": _TEN_YEARS},
    MONITORING_REFRESH: {"required": ("trigger",), "retention_days": _SEVEN_YEARS},
    TRANSACTION_NORMALISED: {"required": ("merchant_id", "amount_base"), "retention_days": _SEVEN_YEARS},
    ACTION_EXECUTED: {"required": ("action_type", "actor"), "retention_days": _TEN_YEARS},
    OUTCOME_LABELLED: {"required": ("subject_type", "subject_id", "label"), "retention_days": _SEVEN_YEARS},
}

# --- internal subscription names, mapped onto canonical topics ------------------------------

SANCTIONS_LIST_UPDATED = "screening.list_updated"
REGISTRY_RECORD_CHANGED = "registry.record_changed"
TRANSACTION_SIGNAL = "transactions.signal"
MERCHANT_BOARDED = "merchant.boarded"
DOCUMENT_APPROVED = "knowledge.document_approved"
ENTITY_OFFBOARDED = "entity.offboarded"

CANONICAL_TOPIC: dict[str, str] = {
    SANCTIONS_LIST_UPDATED: MONITORING_REFRESH,
    REGISTRY_RECORD_CHANGED: MONITORING_REFRESH,
    TRANSACTION_SIGNAL: MONITORING_REFRESH,
    MERCHANT_BOARDED: ASSESSMENT_COMPLETED,
    DOCUMENT_APPROVED: KNOWLEDGE_UPDATED,
    ENTITY_OFFBOARDED: MONITORING_REFRESH,
}

_subscribers: dict[str, list[Handler]] = defaultdict(list)
_history: list[Event] = []
_handled_event_ids: set[tuple[str, str]] = set()


def subscribe(event_name: str, handler: Handler) -> None:
    if handler not in _subscribers[event_name]:
        _subscribers[event_name].append(handler)


def topic_for(event_name: str) -> str:
    """The canonical topic an internal event name is recorded under."""
    if event_name in TOPICS:
        return event_name
    return CANONICAL_TOPIC.get(event_name, MONITORING_REFRESH)


def _validate(topic: str, payload: dict[str, Any]) -> None:
    spec = TOPICS.get(topic)
    if spec is None:
        raise SchemaError(f"unregistered topic '{topic}'")
    missing = [key for key in spec["required"] if key not in payload]
    if missing:
        raise SchemaError(f"topic '{topic}' requires {', '.join(sorted(missing))}")


def record(session: Session, event: Event, *, topic: str | None = None) -> PlatformEvent:
    """Persist an event on the fabric without invoking handlers (used by replay and publish)."""
    resolved = topic or topic_for(event.name)
    payload = dict(event.payload)
    if resolved in {MONITORING_REFRESH} and "trigger" not in payload:
        payload["trigger"] = event.name
    _validate(resolved, payload)
    row = PlatformEvent(
        event_id=event.event_id or str(uuid.uuid4()),
        topic=resolved,
        producer=event.producer,
        subject_type=event.subject_type,
        subject_id=event.subject_id,
        payload=payload,
        occurred_at=event.occurred_at or utcnow(),
        retention_days=int(TOPICS[resolved]["retention_days"]),
    )
    session.add(row)
    session.flush()
    return row


def publish(session: Session, event: Event, *, topic: str | None = None) -> int:
    """Record the event durably, then fan it out to idempotent handlers."""
    row = record(session, event, topic=topic)
    stamped = Event(
        name=event.name,
        subject_type=event.subject_type,
        subject_id=event.subject_id,
        payload=row.payload,
        occurred_at=row.occurred_at,
        producer=event.producer,
        event_id=row.event_id,
    )
    _history.append(stamped)
    handled = _dispatch(session, stamped)
    row.handlers_invoked = handled
    session.flush()
    return handled


def _dispatch(session: Session, event: Event) -> int:
    handlers = _subscribers.get(event.name, [])
    invoked = 0
    for handler in handlers:
        key = (f"{handler.__module__}.{handler.__qualname__}", event.event_id or "")
        if key in _handled_event_ids:
            continue
        handler(session, event)
        _handled_event_ids.add(key)
        invoked += 1
    return invoked


def replay(
    session: Session,
    *,
    topics: Iterable[str] | None = None,
    since: dt.datetime | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Rebuild consumer state from the log.

    ``dry_run`` reports what would be delivered; a real replay re-dispatches to handlers, which are
    idempotent per (handler, event_id) so a replay of already-seen events is a no-op.
    """
    stmt = select(PlatformEvent).order_by(PlatformEvent.id)
    if since is not None:
        stmt = stmt.where(PlatformEvent.occurred_at >= since)
    rows = list(session.execute(stmt).scalars().all())
    wanted = set(topics) if topics else None
    selected = [row for row in rows if wanted is None or row.topic in wanted]
    delivered = 0
    if not dry_run:
        for row in selected:
            internal = next(
                (name for name, topic in CANONICAL_TOPIC.items() if topic == row.topic),
                row.topic,
            )
            delivered += _dispatch(
                session,
                Event(
                    name=str(row.payload.get("trigger") or internal),
                    subject_type=row.subject_type,
                    subject_id=row.subject_id,
                    payload=row.payload,
                    occurred_at=row.occurred_at,
                    event_id=row.event_id,
                ),
            )
    return {
        "dry_run": dry_run,
        "matched": len(selected),
        "redelivered": delivered,
        "topics": sorted({row.topic for row in selected}),
    }


def log(session: Session, *, topic: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    stmt = select(PlatformEvent).order_by(PlatformEvent.id.desc()).limit(limit)
    if topic:
        stmt = stmt.where(PlatformEvent.topic == topic)
    return [
        {
            "event_id": row.event_id,
            "topic": row.topic,
            "schema_version": row.schema_version,
            "producer": row.producer,
            "subject_type": row.subject_type,
            "subject_id": row.subject_id,
            "payload": row.payload,
            "occurred_at": row.occurred_at,
            "recorded_at": row.recorded_at,
            "handlers_invoked": row.handlers_invoked,
            "retention_days": row.retention_days,
        }
        for row in session.execute(stmt).scalars().all()
    ]


def topic_register() -> list[dict[str, Any]]:
    return [
        {
            "topic": topic,
            "required_payload": sorted(spec["required"]),
            "retention_days": spec["retention_days"],
            "internal_triggers": sorted(
                name for name, canonical in CANONICAL_TOPIC.items() if canonical == topic
            ),
        }
        for topic, spec in sorted(TOPICS.items())
    ]


def history() -> list[Event]:
    return list(_history)


def reset() -> None:
    _subscribers.clear()
    _history.clear()
    _handled_event_ids.clear()
