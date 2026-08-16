"""PLS-16 transaction stream normalisation.

Every acquiring, gateway and orchestration platform describes the same authorisation differently.
This component turns those into one canonical shape, resolves the merchant identifier to a Pulse
entity, converts to the base currency and deduplicates — so DETECT has a single stream to reason
about and a merchant's exposure is not double counted because two platforms reported it.

Normalisation is deliberately cheap: the NFR is p99 < 2s from raw event to detection, and the
detection hand-off is an event, not a synchronous call.
"""

from __future__ import annotations

import datetime as dt
import time
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Merchant, TransactionEvent, utcnow
from app.services import events

# Indicative static rates; a production build reads these from the rates service with an as-of date.
FX_TO_BASE: dict[str, float] = {"EUR": 1.0, "USD": 0.92, "GBP": 1.17, "SEK": 0.087, "PLN": 0.23}

# source platform -> field mapping onto the canonical shape
FIELD_MAPS: dict[str, dict[str, str]] = {
    "acquiring": {
        "external_id": "auth_id",
        "merchant_ref": "mid",
        "amount": "amount",
        "currency": "currency",
        "occurred_at": "auth_time",
        "channel": "entry_mode",
        "country": "issuer_country",
        "mcc": "mcc",
    },
    "gateway": {
        "external_id": "transaction_reference",
        "merchant_ref": "merchant_account",
        "amount": "value",
        "currency": "iso_currency",
        "occurred_at": "created",
        "channel": "channel",
        "country": "country",
        "mcc": "category_code",
    },
}


class NormalisationError(ValueError):
    """A raw event that cannot be placed on the canonical stream."""


def _coerce_time(value: Any) -> dt.datetime:
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
    if isinstance(value, str):
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise NormalisationError(f"unparseable timestamp {value!r}") from exc
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    return utcnow()


def _jsonable(raw: dict[str, Any]) -> dict[str, Any]:
    """The raw event is kept verbatim as evidence, so it must survive the JSON column."""
    return {
        key: value.isoformat() if isinstance(value, (dt.datetime, dt.date)) else value
        for key, value in raw.items()
    }


def to_base(amount: float, currency: str) -> float:
    rate = FX_TO_BASE.get(currency.upper())
    if rate is None:
        raise NormalisationError(f"no base rate configured for {currency!r}")
    return round(amount * rate, 2)


def normalise(
    session: Session,
    *,
    raw: dict[str, Any],
    source_platform: str = "acquiring",
    event_type: str = "authorisation",
) -> TransactionEvent | None:
    """Place one raw platform event on the canonical stream.

    Returns ``None`` when the event is a duplicate: replays and overlapping platform feeds are
    expected, so idempotency is part of the contract rather than an error.
    """
    started = time.perf_counter()
    mapping = FIELD_MAPS.get(source_platform)
    if mapping is None:
        raise NormalisationError(f"no field map for source platform {source_platform!r}")

    merchant_ref = raw.get(mapping["merchant_ref"])
    if merchant_ref is None:
        raise NormalisationError(f"raw event has no {mapping['merchant_ref']}")
    merchant = session.execute(
        select(Merchant).where(Merchant.platform_mid == str(merchant_ref))
    ).scalars().first()
    if merchant is None:
        raise NormalisationError(f"unresolved merchant reference {merchant_ref!r}")

    external_id = raw.get(mapping["external_id"])
    if external_id is None:
        raise NormalisationError(f"raw event has no {mapping['external_id']}")
    dedupe_key = f"{source_platform}:{event_type}:{external_id}"
    if session.execute(
        select(TransactionEvent).where(TransactionEvent.dedupe_key == dedupe_key)
    ).scalars().first() is not None:
        return None

    amount = float(raw.get(mapping["amount"], 0.0))
    currency = str(raw.get(mapping["currency"], "EUR")).upper()
    occurred_at = _coerce_time(raw.get(mapping["occurred_at"]))

    row = TransactionEvent(
        dedupe_key=dedupe_key,
        merchant_id=merchant.id,
        entity_id=merchant.entity_id,
        source_platform=source_platform,
        event_type=event_type,
        amount=amount,
        currency=currency,
        amount_base=to_base(amount, currency),
        channel=raw.get(mapping["channel"]),
        country=raw.get(mapping["country"]),
        mcc=raw.get(mapping["mcc"]),
        occurred_at=occurred_at,
        normalised_at=utcnow(),
        raw=_jsonable(raw),
    )
    row.normalisation_ms = int((time.perf_counter() - started) * 1000)
    session.add(row)
    session.flush()

    events.publish(
        session,
        events.Event(
            name=events.TRANSACTION_NORMALISED,
            subject_type="merchant",
            subject_id=merchant.id,
            payload={
                "merchant_id": merchant.id,
                "entity_id": merchant.entity_id,
                "amount_base": row.amount_base,
                "currency": currency,
                "event_type": event_type,
                "source_platform": source_platform,
                "mcc": row.mcc,
                "country": row.country,
            },
            occurred_at=occurred_at,
        ),
        topic=events.TRANSACTION_NORMALISED,
    )
    return row


def ingest(
    session: Session, *, batch: list[dict[str, Any]], source_platform: str = "acquiring"
) -> dict[str, Any]:
    accepted = 0
    duplicates = 0
    rejected: list[dict[str, str]] = []
    latencies: list[int] = []
    for raw in batch:
        try:
            row = normalise(session, raw=raw, source_platform=source_platform)
        except NormalisationError as exc:
            rejected.append({"raw": repr(raw)[:160], "reason": str(exc)})
            continue
        if row is None:
            duplicates += 1
            continue
        accepted += 1
        latencies.append(row.normalisation_ms)
    ordered = sorted(latencies) or [0]
    return {
        "accepted": accepted,
        "duplicates": duplicates,
        "rejected": rejected,
        "p99_normalisation_ms": ordered[min(len(ordered) - 1, int(len(ordered) * 0.99))],
    }


def exposure(session: Session, merchant_id: int, *, window_days: int = 30) -> dict[str, Any]:
    since = utcnow() - dt.timedelta(days=window_days)
    rows = session.execute(
        select(TransactionEvent).where(
            TransactionEvent.merchant_id == merchant_id,
            TransactionEvent.occurred_at >= since,
        )
    ).scalars().all()
    total = round(sum(row.amount_base for row in rows), 2)
    by_country: dict[str, float] = {}
    for row in rows:
        key = row.country or "unknown"
        by_country[key] = round(by_country.get(key, 0.0) + row.amount_base, 2)
    return {
        "merchant_id": merchant_id,
        "window_days": window_days,
        "events": len(rows),
        "volume_base": total,
        "by_country": dict(sorted(by_country.items())),
    }


def stream_health(session: Session) -> dict[str, Any]:
    total = session.execute(select(func.count()).select_from(TransactionEvent)).scalar_one()
    by_platform = session.execute(
        select(TransactionEvent.source_platform, func.count(TransactionEvent.id)).group_by(
            TransactionEvent.source_platform
        )
    ).all()
    worst = session.execute(select(func.max(TransactionEvent.normalisation_ms))).scalar()
    return {
        "events": int(total),
        "by_platform": {str(name): int(count) for name, count in by_platform},
        "max_normalisation_ms": int(worst or 0),
        "target_p99_ms": 2000,
    }
