"""PLS-15 feature store: one definition per feature, shared by training and serving.

The failure this component exists to prevent is training/serving skew: a feature computed one way in
a notebook and another way in the request path, so a model behaves differently in production than in
validation. Features are therefore *declared* — name, owner, entity, window, source scopes, whether
they are online-servable — and computed only through :func:`compute`.

Every served vector carries the definition versions it used, so a score can be replayed.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, Merchant, ScreeningHit
from app.services import graph


@dataclass(frozen=True)
class FeatureDefinition:
    key: str
    entity: str
    description: str
    version: str
    owner: str
    window: str
    sources: tuple[str, ...]
    online: bool
    compute: Callable[[Session, Merchant], Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "entity": self.entity,
            "description": self.description,
            "version": self.version,
            "owner": self.owner,
            "window": self.window,
            "sources": list(self.sources),
            "online": self.online,
        }


def _chargeback_rate(session: Session, merchant: Merchant) -> float:
    _ = session
    return float(merchant.chargeback_rate or 0.0)


def _monthly_volume(session: Session, merchant: Merchant) -> float:
    _ = session
    return float(merchant.monthly_volume or 0.0)


def _volume_ratio(session: Session, merchant: Merchant) -> float:
    _ = session
    declared = float(merchant.declared_volume or 0.0)
    actual = float(merchant.monthly_volume or 0.0)
    return round(actual / declared, 4) if declared else 0.0


def _open_alerts(session: Session, merchant: Merchant) -> int:
    return len(
        session.execute(
            select(Alert).where(Alert.entity_id == merchant.entity_id, Alert.status == "open")
        ).scalars().all()
    )


def _true_match_hits(session: Session, merchant: Merchant) -> int:
    return len(
        session.execute(
            select(ScreeningHit).where(
                ScreeningHit.entity_id == merchant.entity_id,
                ScreeningHit.disposition == "true_match",
            )
        ).scalars().all()
    )


def _linked_to_offboarded(session: Session, merchant: Merchant) -> int:
    try:
        analysis = graph.link_analysis(session, merchant.entity_id, max_hops=3)
    except LookupError:
        return 0
    return sum(
        1 for flag in analysis["risk_flags"] if flag["flag"] == "linked_to_offboarded_entity"
    )


DEFINITIONS: tuple[FeatureDefinition, ...] = (
    FeatureDefinition(
        "merchant.chargeback_rate",
        "merchant",
        "Chargebacks as a share of settled volume",
        "1",
        "payments.platform@pulse.example",
        "rolling_30d",
        ("acquiring",),
        True,
        _chargeback_rate,
    ),
    FeatureDefinition(
        "merchant.monthly_volume",
        "merchant",
        "Settled volume in the base currency",
        "1",
        "payments.platform@pulse.example",
        "rolling_30d",
        ("acquiring",),
        True,
        _monthly_volume,
    ),
    FeatureDefinition(
        "merchant.volume_ratio",
        "merchant",
        "Observed volume over volume declared at application",
        "1",
        "risk.ops@pulse.example",
        "rolling_30d",
        ("acquiring", "application"),
        True,
        _volume_ratio,
    ),
    FeatureDefinition(
        "merchant.open_alerts",
        "merchant",
        "Count of open monitoring alerts",
        "1",
        "risk.ops@pulse.example",
        "point_in_time",
        ("internal",),
        True,
        _open_alerts,
    ),
    FeatureDefinition(
        "screening.sanctions_true_match",
        "entity",
        "Confirmed watchlist matches on the entity",
        "1",
        "sanctions.ops@pulse.example",
        "point_in_time",
        ("sanctions",),
        True,
        _true_match_hits,
    ),
    FeatureDefinition(
        "network.linked_to_offboarded",
        "entity",
        "Distinct offboarded entities reachable within three hops",
        "1",
        "financial.crime@pulse.example",
        "point_in_time",
        ("registry", "internal"),
        True,
        _linked_to_offboarded,
    ),
)

BY_KEY: dict[str, FeatureDefinition] = {definition.key: definition for definition in DEFINITIONS}


class UnknownFeature(KeyError):
    """A feature was requested that no definition declares."""


def registry() -> list[dict[str, Any]]:
    return [definition.as_dict() for definition in DEFINITIONS]


def compute(
    session: Session, merchant: Merchant, keys: list[str] | tuple[str, ...] | None = None
) -> dict[str, Any]:
    """Serve a feature vector, with the definition versions that produced it."""
    wanted = list(keys) if keys else [definition.key for definition in DEFINITIONS]
    unknown = [key for key in wanted if key not in BY_KEY]
    if unknown:
        raise UnknownFeature(f"undeclared feature(s): {', '.join(sorted(unknown))}")
    values: dict[str, Any] = {}
    versions: dict[str, str] = {}
    for key in wanted:
        definition = BY_KEY[key]
        values[key] = definition.compute(session, merchant)
        versions[key] = definition.version
    return {"values": values, "definition_versions": versions}
