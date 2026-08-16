"""PLS-82 context assembly: the only way data reaches an agent or a model.

An agent has no credentials, no browser and no database handle. It receives a **manifest** built
here: the intersection of its declared data scope and the invoking caller's entitlements, with every
included value carrying provenance and freshness, and everything it asked for but may not see listed
explicitly as denied. The manifest hash is recorded with the model invocation, so an answer can be
traced to the exact context that produced it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, Case, Merchant, ScreeningHit
from app.services import ai_gateway, entitlements, provenance

# Which platform reads satisfy which declared scope. A scope with no builder here yields nothing:
# the manifest is allow-listed, so a typo in an ARP cannot silently widen access.
SCOPE_SOURCES: tuple[str, ...] = (
    "entity.*",
    "merchant.*",
    "facts.*",
    "facts.registry.*",
    "facts.application.*",
    "screening.hits",
    "graph.ownership",
    "graph.network",
    "alerts.*",
    "cases.*",
    "scores.*",
    "credit.summary",
    "knowledge.*",
    "documents.*",
    "evidence.*",
)


@dataclass
class ContextManifest:
    subject_type: str
    subject_id: int | None
    caller: dict[str, Any]
    granted_scopes: list[str]
    denied_scopes: list[str]
    data: dict[str, Any] = field(default_factory=dict)
    provenance: list[dict[str, Any]] = field(default_factory=list)
    freshness: dict[str, Any] = field(default_factory=dict)
    degraded: bool = False

    @property
    def hash(self) -> str:
        return ai_gateway.manifest_hash(self.data)

    def as_dict(self) -> dict[str, Any]:
        return {
            "subject_type": self.subject_type,
            "subject_id": self.subject_id,
            "caller": self.caller,
            "granted_scopes": self.granted_scopes,
            "denied_scopes": self.denied_scopes,
            "data": self.data,
            "provenance": self.provenance,
            "freshness": self.freshness,
            "degraded": self.degraded,
            "manifest_hash": self.hash,
        }


def assemble(
    session: Session,
    *,
    caller: entitlements.Caller,
    declared_scopes: list[str] | tuple[str, ...],
    entity_id: int | None = None,
    subject_type: str = "entity",
    extra: dict[str, Any] | None = None,
) -> ContextManifest:
    granted = entitlements.intersect(caller, list(declared_scopes))
    denied = [scope for scope in declared_scopes if scope not in granted]

    data: dict[str, Any] = {}
    prov: list[dict[str, Any]] = []
    freshness: dict[str, Any] = {}

    if entity_id is not None:
        reconciled = provenance.effective(session, entity_id)
        for attribute, fact in reconciled.items():
            scope = f"facts.{attribute}"
            # The value must be inside a granted pathway scope *and* inside the caller's own
            # entitlements — the intersection, never the union.
            if not any(entitlements.matches(scope, grant) for grant in granted):
                continue
            if not entitlements.permits(caller, scope):
                continue
            if not entitlements.permits_classification(caller, fact.classification):
                denied.append(scope)
                continue
            data[scope] = fact.value
            prov.append(fact.as_dict())
        freshness = provenance.staleness_report(session, entity_id)

        if "merchant.*" in granted:
            merchant = session.execute(
                select(Merchant).where(Merchant.entity_id == entity_id)
            ).scalars().first()
            if merchant is not None:
                data["merchant.display_name"] = merchant.display_name
                data["merchant.lifecycle_state"] = merchant.lifecycle_state
                data["merchant.chargeback_rate"] = merchant.chargeback_rate
                data["merchant.monthly_volume"] = merchant.monthly_volume
                data["merchant.mcc"] = merchant.mcc
                data["merchant.business_model"] = merchant.business_model
        if "screening.hits" in granted:
            hits = session.execute(
                select(ScreeningHit).where(ScreeningHit.entity_id == entity_id)
            ).scalars().all()
            data["screening.hits"] = [
                {
                    "list_type": hit.list_type,
                    "list_name": hit.list_name,
                    "matched_name": hit.matched_name,
                    "score": hit.score,
                    "disposition": hit.disposition,
                }
                for hit in hits
            ]
        if "alerts.*" in granted:
            alerts = session.execute(
                select(Alert).where(Alert.entity_id == entity_id, Alert.status == "open")
            ).scalars().all()
            data["alerts.open"] = [
                {"monitor_key": a.monitor_key, "severity": a.severity, "title": a.title}
                for a in alerts
            ]
        if "cases.*" in granted:
            case_rows = session.execute(
                select(Case).where(Case.entity_id == entity_id)
            ).scalars().all()
            data["cases.history"] = [
                {
                    "case_type": c.case_type,
                    "status": c.status,
                    "disposition": c.disposition,
                    "resolution": c.resolution,
                }
                for c in case_rows
            ]

    for key, value in (extra or {}).items():
        scope = key.split(".")[0] + ".*"
        if entitlements.permits(caller, key) or entitlements.permits(caller, scope):
            data[key] = value
        else:
            denied.append(key)

    return ContextManifest(
        subject_type=subject_type,
        subject_id=entity_id,
        caller=caller.as_dict(),
        granted_scopes=granted,
        denied_scopes=sorted(set(denied)),
        data=data,
        provenance=prov,
        freshness=freshness,
        degraded=bool(freshness.get("degraded")),
    )
