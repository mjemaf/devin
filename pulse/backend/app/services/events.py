"""In-process event bus shaped like the production event fabric.

Perpetual monitoring is event-driven: nothing polls a table looking for work. Swapping this for
Kafka/PubSub is an adapter change — publishers and subscribers keep the same contract.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session


@dataclass(frozen=True)
class Event:
    name: str
    subject_type: str
    subject_id: int | None = None
    payload: dict[str, Any] = field(default_factory=dict)


Handler = Callable[[Session, Event], None]

# Event names are referenced by Monitor.event_triggers.
SANCTIONS_LIST_UPDATED = "screening.list_updated"
REGISTRY_RECORD_CHANGED = "registry.record_changed"
TRANSACTION_SIGNAL = "transactions.signal"
MERCHANT_BOARDED = "merchant.boarded"
DOCUMENT_APPROVED = "knowledge.document_approved"
ENTITY_OFFBOARDED = "entity.offboarded"

_subscribers: dict[str, list[Handler]] = defaultdict(list)
_history: list[Event] = []


def subscribe(event_name: str, handler: Handler) -> None:
    if handler not in _subscribers[event_name]:
        _subscribers[event_name].append(handler)


def publish(session: Session, event: Event) -> int:
    _history.append(event)
    handlers = _subscribers.get(event.name, [])
    for handler in handlers:
        handler(session, event)
    return len(handlers)


def history() -> list[Event]:
    return list(_history)


def reset() -> None:
    _subscribers.clear()
    _history.clear()
