"""Perpetual monitoring: the portfolio is re-assessed on events, not on an annual calendar.

Two entry points:

* :func:`sweep` — scheduled surveillance across the book (drift, chargebacks, volume, overdue
  reviews, network changes).
* event handlers — a sanctions list update or registry change re-screens *only* the affected
  population immediately, which is the difference between periodic and perpetual KYC.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, Entity, Merchant, Monitor, utcnow
from app.providers import gateway
from app.services import audit, cases, events, graph, materiality, policy, scoring, screening

MONITORS: list[dict[str, Any]] = [
    {
        "key": "sanctions_rescreen",
        "description": "Re-screen the active book whenever a watchlist changes",
        "cadence_days": 1,
        "event_triggers": [events.SANCTIONS_LIST_UPDATED],
    },
    {
        "key": "registry_change",
        "description": "React to registry status, officer or ownership changes",
        "cadence_days": 7,
        "event_triggers": [events.REGISTRY_RECORD_CHANGED],
    },
    {
        "key": "business_model_drift",
        "description": "Detect selling outside the underwritten business model",
        "cadence_days": 1,
        "event_triggers": [events.TRANSACTION_SIGNAL],
    },
    {
        "key": "chargeback_threshold",
        "description": "Scheme chargeback monitoring thresholds",
        "cadence_days": 1,
        "event_triggers": [events.TRANSACTION_SIGNAL],
    },
    {
        "key": "network_change",
        "description": "New link discovered to an off-boarded or listed party",
        "cadence_days": 7,
        "event_triggers": [events.ENTITY_OFFBOARDED],
    },
    {
        "key": "periodic_review",
        "description": "Risk-based periodic KYC/KYB refresh due",
        "cadence_days": 1,
        "event_triggers": [],
    },
]

SEVERITY_BY_OUTCOME = {
    "hold_funds": "critical",
    "terminate": "critical",
    "restrict": "high",
    "watch": "medium",
    "no_action": "low",
}


def install(session: Session) -> list[Monitor]:
    installed: list[Monitor] = []
    for spec in MONITORS:
        monitor = session.execute(select(Monitor).where(Monitor.key == spec["key"])).scalar()
        if monitor is None:
            monitor = Monitor(key=spec["key"])
            session.add(monitor)
        monitor.description = spec["description"]
        monitor.cadence_days = spec["cadence_days"]
        monitor.event_triggers = spec["event_triggers"]
        installed.append(monitor)
    session.flush()
    return installed


def raise_alert(
    session: Session,
    *,
    entity_id: int,
    monitor_key: str,
    severity: str,
    title: str,
    detail: str,
    signals: dict[str, Any],
    open_case: bool = True,
    actor: str = "monitor",
) -> Alert:
    existing = session.execute(
        select(Alert).where(
            Alert.entity_id == entity_id,
            Alert.monitor_key == monitor_key,
            Alert.status == "open",
        )
    ).scalars().first()
    alert = existing or Alert(entity_id=entity_id, monitor_key=monitor_key)
    if existing is not None:
        alert.occurrences += 1
    alert.last_seen_at = utcnow()
    alert.severity = severity
    alert.title = title
    alert.detail = detail
    alert.signals = signals
    alert.status = "open"
    session.add(alert)
    session.flush()

    if open_case and severity in {"high", "critical"} and alert.case_id is None:
        case = cases.open_case(
            session,
            entity_id=entity_id,
            case_type=f"monitoring_{monitor_key}",
            title=title,
            severity=severity,
            created_by=actor,
            note=detail,
        )
        alert.case_id = case.id
        session.flush()

    audit.append(
        session,
        actor=actor,
        actor_role="system",
        action="monitoring.alert_raised",
        subject_type="alert",
        subject_id=alert.id,
        payload={
            "entity_id": entity_id,
            "monitor_key": monitor_key,
            "severity": severity,
            "title": title,
            "case_id": alert.case_id,
        },
    )
    return alert


def _merchant_facts(session: Session, merchant: Merchant) -> dict[str, Any]:
    entity_id = merchant.entity_id
    network = graph.link_analysis(session, entity_id)
    hits = screening.screen_entity(session, entity_id, trigger="perpetual", actor="monitor")
    underwritten = max(merchant.credit_limit, 1.0)
    overdue_days = 0
    if merchant.last_reviewed_at is not None:
        due = merchant.last_reviewed_at + dt.timedelta(days=merchant.review_cadence_days)
        overdue_days = max(0, (utcnow() - due.replace(tzinfo=dt.timezone.utc)).days)
    drift = bool(
        (
            merchant.underwritten_business_model
            and merchant.business_model
            and merchant.underwritten_business_model != merchant.business_model
        )
        or (merchant.underwritten_mcc and merchant.mcc and merchant.underwritten_mcc != merchant.mcc)
    )
    return {
        "screening.sanctions_true_match": hits["sanctions_true_match"],
        "merchant.model_drift": drift,
        "merchant.chargeback_rate": merchant.chargeback_rate,
        "merchant.volume_ratio": merchant.monthly_volume / underwritten,
        "network.linked_to_offboarded": any(
            flag["flag"] == "linked_to_offboarded_entity" for flag in network["risk_flags"]
        ),
        "merchant.review_overdue_days": overdue_days,
        "_screening": hits,
        "_network": network,
    }


def assess_merchant(session: Session, merchant: Merchant, *, actor: str = "monitor") -> dict[str, Any]:
    """Evaluate one merchant against the monitoring policy pack and raise alerts."""
    facts = _merchant_facts(session, merchant)
    evaluation = policy.evaluate(
        "monitoring", {k: v for k, v in facts.items() if not k.startswith("_")}
    )
    signals = scoring.build_signals(
        screening=facts["_screening"],
        network=facts["_network"],
        merchant=merchant,
        kyb={"country": merchant.region},
    )
    score = scoring.score(
        session, merchant.entity_id, signals, cohort_key=f"{merchant.mcc}:{merchant.segment}"
    )

    alerts: list[int] = []
    if evaluation.outcome != "no_action":
        consequence = materiality.assess(
            action=evaluation.outcome,
            financial_exposure=merchant.monthly_volume,
            customers_affected=1,
            regulatory_notice_required=evaluation.outcome in {"hold_funds", "terminate"},
            risk_band=score.band,
        )
        for reason in evaluation.reason_codes:
            alert = raise_alert(
                session,
                entity_id=merchant.entity_id,
                monitor_key=_monitor_for_reason(reason["code"]),
                severity=SEVERITY_BY_OUTCOME.get(evaluation.outcome, "medium"),
                title=f"{reason['code']}: {merchant.display_name}",
                detail=reason["text"],
                signals={
                    "policy_outcome": evaluation.outcome,
                    "rule_id": reason["rule_id"],
                    "risk_score": score.value,
                    "risk_band": score.band,
                    "materiality": consequence.as_dict(),
                },
                actor=actor,
            )
            alerts.append(alert.id)

    return {
        "merchant_id": merchant.id,
        "entity_id": merchant.entity_id,
        "display_name": merchant.display_name,
        "outcome": evaluation.outcome,
        "reason_codes": evaluation.reason_codes,
        "risk_score": score.value,
        "risk_band": score.band,
        "alert_ids": alerts,
    }


def _monitor_for_reason(reason_code: str) -> str:
    return {
        "POST_BOARDING_SANCTIONS_MATCH": "sanctions_rescreen",
        "BUSINESS_MODEL_DRIFT": "business_model_drift",
        "EXCESSIVE_CHARGEBACKS": "chargeback_threshold",
        "VOLUME_SPIKE": "chargeback_threshold",
        "NETWORK_LINK_DISCOVERED": "network_change",
        "REVIEW_OVERDUE": "periodic_review",
    }.get(reason_code, "periodic_review")


def sweep(session: Session, *, actor: str = "monitor") -> dict[str, Any]:
    """Run portfolio surveillance across all active merchants."""
    install(session)
    merchants = session.execute(
        select(Merchant).where(Merchant.lifecycle_state.in_(["boarded", "active"]))
    ).scalars().all()
    results = [assess_merchant(session, merchant, actor=actor) for merchant in merchants]
    for monitor in session.execute(select(Monitor)).scalars():
        monitor.last_run_at = utcnow()
    session.flush()
    audit.append(
        session,
        actor=actor,
        action="monitoring.sweep",
        subject_type="portfolio",
        payload={
            "merchants_assessed": len(results),
            "actions": {
                outcome: sum(1 for row in results if row["outcome"] == outcome)
                for outcome in {row["outcome"] for row in results}
            },
        },
    )
    return {
        "merchants_assessed": len(results),
        "results": sorted(results, key=lambda row: -row["risk_score"]),
        "cohorts": scoring.cohort_stats(session),
    }


# ------------------------------------------------------------------------------------------
# Event handlers — perpetual, not periodic
# ------------------------------------------------------------------------------------------


def on_list_updated(session: Session, event: events.Event) -> None:
    """A watchlist changed: re-screen the active book against the new list immediately."""
    gateway.clear_cache()
    merchants = session.execute(
        select(Merchant).where(Merchant.lifecycle_state.in_(["boarded", "active"]))
    ).scalars().all()
    for merchant in merchants:
        result = screening.screen_entity(
            session, merchant.entity_id, trigger="list_update", actor="monitor"
        )
        if result["sanctions_true_match"]:
            raise_alert(
                session,
                entity_id=merchant.entity_id,
                monitor_key="sanctions_rescreen",
                severity="critical",
                title=f"Post-boarding sanctions match: {merchant.display_name}",
                detail="A confirmed sanctions match arose from a list update; suspend settlement.",
                signals={"trigger": event.name, "payload": event.payload},
                actor="monitor",
            )


def on_registry_change(session: Session, event: events.Event) -> None:
    entity_id = int(event.payload["entity_id"])
    entity = session.get(Entity, entity_id)
    if entity is None:
        return
    status = event.payload.get("status")
    if status and status != "active":
        raise_alert(
            session,
            entity_id=entity_id,
            monitor_key="registry_change",
            severity="high",
            title=f"Registry status changed to '{status}': {entity.legal_name}",
            detail="The official register no longer shows this company as active.",
            signals={"trigger": event.name, "payload": event.payload},
            actor="monitor",
        )


def on_transaction_signal(session: Session, event: events.Event) -> None:
    """Transaction-time signals update the merchant then re-run the monitoring policy."""
    merchant = session.get(Merchant, int(event.payload["merchant_id"]))
    if merchant is None:
        return
    if "monthly_volume" in event.payload:
        merchant.monthly_volume = float(event.payload["monthly_volume"])
    if "chargeback_rate" in event.payload:
        merchant.chargeback_rate = float(event.payload["chargeback_rate"])
    if "business_model" in event.payload:
        merchant.business_model = str(event.payload["business_model"])
    if "mcc" in event.payload:
        merchant.mcc = str(event.payload["mcc"])
    session.flush()
    assess_merchant(session, merchant, actor="monitor")


def on_entity_offboarded(session: Session, event: events.Event) -> None:
    """When an entity is off-boarded, everything connected to it is re-assessed."""
    entity_id = int(event.payload["entity_id"])
    entity = session.get(Entity, entity_id)
    if entity is None:
        return
    entity.status = "offboarded"
    entity.offboarded_reason = event.payload.get("reason")
    session.flush()
    network = graph.link_analysis(session, entity_id)
    for neighbour in network["neighbours"]:
        merchant = session.execute(
            select(Merchant).where(Merchant.entity_id == neighbour["entity_id"])
        ).scalars().first()
        if merchant is None or merchant.lifecycle_state not in {"boarded", "active"}:
            continue
        raise_alert(
            session,
            entity_id=neighbour["entity_id"],
            monitor_key="network_change",
            severity="high" if neighbour["path_strength"] >= 0.5 else "medium",
            title=f"Connected party off-boarded: {merchant.display_name}",
            detail=(
                f"{entity.legal_name} was off-boarded ({entity.offboarded_reason}); this merchant is "
                f"{neighbour['hops']} hop(s) away via "
                + ", ".join(sorted({link["rel_type"] for link in neighbour["links"]}))
            ),
            signals={"trigger": event.name, "path": neighbour["path"]},
            actor="monitor",
        )


def register_handlers() -> None:
    events.subscribe(events.SANCTIONS_LIST_UPDATED, on_list_updated)
    events.subscribe(events.REGISTRY_RECORD_CHANGED, on_registry_change)
    events.subscribe(events.TRANSACTION_SIGNAL, on_transaction_signal)
    events.subscribe(events.ENTITY_OFFBOARDED, on_entity_offboarded)
