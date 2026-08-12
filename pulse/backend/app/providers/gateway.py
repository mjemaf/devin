"""The single governed egress to third-party data: cached, metered, cost-attributed."""

from __future__ import annotations

import datetime as dt
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ProviderCall, utcnow
from app.providers import adverse_media, bureau, registry, sanctions

# provider -> operation -> (callable, unit cost)
Adapter = Callable[[dict[str, Any]], dict[str, Any]]

_ADAPTERS: dict[str, dict[str, tuple[Adapter, float]]] = {
    "registry": {
        "lookup_company": (registry.lookup_company, 1.40),
        "lookup_officers": (registry.lookup_officers, 0.90),
        "lookup_ownership": (registry.lookup_ownership, 2.10),
    },
    "sanctions": {"screen": (sanctions.screen, 0.35)},
    "adverse_media": {"search": (adverse_media.search, 0.85)},
    "bureau": {"credit_file": (bureau.credit_file, 4.75)},
}

_CACHE: dict[str, tuple[dt.datetime, dict[str, Any]]] = {}


@dataclass
class ProviderResult:
    provider: str
    operation: str
    data: dict[str, Any]
    cache_hit: bool
    cost: float
    latency_ms: int


def _cache_key(provider: str, operation: str, params: dict[str, Any]) -> str:
    return f"{provider}:{operation}:{json.dumps(params, sort_keys=True, default=str)}"


def call(
    session: Session,
    *,
    provider: str,
    operation: str,
    params: dict[str, Any],
    entity_id: int | None = None,
    requested_by: str = "system",
    allow_cache: bool = True,
) -> ProviderResult:
    """Invoke a third-party operation. Raises ``KeyError`` for unregistered operations."""
    settings = get_settings()
    adapter, unit_cost = _ADAPTERS[provider][operation]
    key = _cache_key(provider, operation, params)
    started = time.perf_counter()

    cached = _CACHE.get(key) if allow_cache else None
    if cached is not None:
        cached_at, data = cached
        age = (utcnow() - cached_at).total_seconds()
        if age > settings.gateway_cache_ttl_seconds:
            cached = None
        else:
            result = ProviderResult(provider, operation, data, True, 0.0, 0)
            _meter(session, result, entity_id, requested_by)
            return result

    data = adapter(params)
    latency_ms = int((time.perf_counter() - started) * 1000)
    _CACHE[key] = (utcnow(), data)
    result = ProviderResult(provider, operation, data, False, unit_cost, latency_ms)
    _meter(session, result, entity_id, requested_by)
    return result


def _meter(
    session: Session, result: ProviderResult, entity_id: int | None, requested_by: str
) -> None:
    session.add(
        ProviderCall(
            provider=result.provider,
            operation=result.operation,
            entity_id=entity_id,
            cache_hit=result.cache_hit,
            cost=result.cost,
            latency_ms=result.latency_ms,
            requested_by=requested_by,
        )
    )
    session.flush()


def spend_report(session: Session) -> dict[str, Any]:
    """Vendor spend, cache effectiveness and cost per boarding — the FinOps view."""
    rows = session.execute(
        select(
            ProviderCall.provider,
            func.count(ProviderCall.id),
            func.sum(ProviderCall.cost),
            func.sum(case((ProviderCall.cache_hit.is_(True), 1), else_=0)),
        ).group_by(ProviderCall.provider)
    ).all()
    by_provider = []
    total_cost = 0.0
    total_calls = 0
    total_hits = 0
    for provider, calls, cost, hits in rows:
        cost = float(cost or 0.0)
        hits = int(hits or 0)
        by_provider.append(
            {
                "provider": provider,
                "calls": calls,
                "cache_hits": hits,
                "cost": round(cost, 2),
                "cache_hit_rate": round(hits / calls, 3) if calls else 0.0,
            }
        )
        total_cost += cost
        total_calls += calls
        total_hits += hits
    return {
        "total_calls": total_calls,
        "total_cost": round(total_cost, 2),
        "cache_hit_rate": round(total_hits / total_calls, 3) if total_calls else 0.0,
        "by_provider": sorted(by_provider, key=lambda row: -row["cost"]),
    }


def clear_cache() -> None:
    _CACHE.clear()
