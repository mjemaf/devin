"""Perpetual monitoring: events drive re-assessment, sweeps catch what events miss."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, Entity, Merchant, Monitor
from app.services import events, monitoring


def _merchant(session: Session, name: str) -> Merchant:
    return session.execute(
        select(Merchant).where(Merchant.display_name == name)
    ).scalars().one()


def _alerts(session: Session, entity_id: int) -> list[Alert]:
    return list(
        session.execute(select(Alert).where(Alert.entity_id == entity_id)).scalars().all()
    )


def test_monitors_are_installed_with_their_event_triggers(session: Session) -> None:
    monitors = session.execute(select(Monitor)).scalars().all()
    assert len(monitors) >= 3
    keys = {monitor.key for monitor in monitors}
    assert {"sanctions_rescreen", "registry_change", "network_change"} <= keys
    assert any(monitor.event_triggers for monitor in monitors)


def test_a_transaction_signal_reassesses_the_merchant_and_raises_an_alert(session: Session) -> None:
    merchant = _merchant(session, "Northwind")
    before = len(_alerts(session, merchant.entity_id))

    handled = events.publish(
        session,
        events.Event(
            name=events.TRANSACTION_SIGNAL,
            subject_type="merchant",
            subject_id=merchant.id,
            payload={
                "merchant_id": merchant.id,
                "monthly_volume": (merchant.monthly_volume or 100_000) * 8,
                "chargeback_rate": 0.035,
            },
        ),
    )
    assert handled >= 1
    assert merchant.chargeback_rate == 0.035
    alerts = _alerts(session, merchant.entity_id)
    assert len(alerts) > before
    latest = alerts[-1]
    assert latest.signals  # the alert has to carry the evidence that raised it
    assert latest.severity in {"low", "medium", "high", "critical"}


def test_business_model_drift_is_detected_from_the_signal(session: Session) -> None:
    merchant = _merchant(session, "Aurora Digital Goods GmbH")
    events.publish(
        session,
        events.Event(
            name=events.TRANSACTION_SIGNAL,
            subject_type="merchant",
            subject_id=merchant.id,
            payload={
                "merchant_id": merchant.id,
                "business_model": "cbd and vape subscription boxes",
                "mcc": "5993",
            },
        ),
    )
    reasons = {
        code["code"]
        for alert in _alerts(session, merchant.entity_id)
        for code in (alert.signals or {}).get("reason_codes", [])
    }
    outcome = monitoring.assess_merchant(session, merchant)
    assert outcome["reason_codes"] or reasons


def test_a_registry_status_change_raises_a_high_severity_alert(session: Session) -> None:
    merchant = _merchant(session, "Cedar Point Payments Inc")
    before = len(_alerts(session, merchant.entity_id))
    events.publish(
        session,
        events.Event(
            name=events.REGISTRY_RECORD_CHANGED,
            subject_type="entity",
            subject_id=merchant.entity_id,
            payload={"entity_id": merchant.entity_id, "status": "dissolved"},
        ),
    )
    alerts = _alerts(session, merchant.entity_id)
    assert len(alerts) == before + 1
    assert alerts[-1].severity == "high"
    assert alerts[-1].monitor_key == "registry_change"


def test_offboarding_an_entity_alerts_its_connected_active_merchants(session: Session) -> None:
    owner = session.execute(
        select(Entity).where(Entity.legal_name == "Sarah Whitfield")
    ).scalars().one()
    northwind = session.execute(
        select(Entity).where(Entity.legal_name == "Northwind Retail Limited")
    ).scalars().one()
    before = len(_alerts(session, northwind.id))

    events.publish(
        session,
        events.Event(
            name=events.ENTITY_OFFBOARDED,
            subject_type="entity",
            subject_id=owner.id,
            payload={"entity_id": owner.id, "reason": "undisclosed ownership"},
        ),
    )
    assert owner.status == "offboarded"
    network_alerts = [
        alert for alert in _alerts(session, northwind.id) if alert.monitor_key == "network_change"
    ]
    assert len(_alerts(session, northwind.id)) > before
    assert network_alerts
    assert "Sarah Whitfield" in network_alerts[-1].detail
    assert network_alerts[-1].case_id is not None, "a high-severity alert must open a case"


def test_offboarding_does_not_alert_merchants_outside_the_active_book(session: Session) -> None:
    """Applicants still in underwriting are handled by the boarding path, not by monitoring."""
    silverline = session.execute(
        select(Entity).where(Entity.legal_name == "Silverline Holdings Ltd")
    ).scalars().one()
    halcyon = session.execute(
        select(Entity).where(Entity.legal_name == "Halcyon Wellness Ltd")
    ).scalars().one()
    halcyon_merchant = session.execute(
        select(Merchant).where(Merchant.entity_id == halcyon.id)
    ).scalars().one()
    assert halcyon_merchant.lifecycle_state == "underwriting"

    events.publish(
        session,
        events.Event(
            name=events.ENTITY_OFFBOARDED,
            subject_type="entity",
            subject_id=silverline.id,
            payload={"entity_id": silverline.id, "reason": "undisclosed ownership"},
        ),
    )
    assert silverline.status == "offboarded"
    assert not [
        alert for alert in _alerts(session, halcyon.id) if alert.monitor_key == "network_change"
    ]


def test_an_unrelated_merchant_is_not_alerted_by_the_offboarding(session: Session) -> None:
    zenith = session.execute(
        select(Entity).where(Entity.legal_name == "Zenith Freight B.V.")
    ).scalars().one()
    assert not [
        alert
        for alert in _alerts(session, zenith.id)
        if alert.monitor_key == "network_change"
    ]


def test_a_sweep_assesses_the_active_book_and_reports_cohorts(session: Session) -> None:
    result = monitoring.sweep(session)
    assert result["merchants_assessed"] >= 5
    assert result["results"]
    scores = [row["risk_score"] for row in result["results"]]
    assert scores == sorted(scores, reverse=True), "worst first, so the queue is actionable"
    assert result["cohorts"]
    for monitor in session.execute(select(Monitor)).scalars():
        assert monitor.last_run_at is not None


def test_alerts_deduplicate_rather_than_flooding_the_queue(session: Session) -> None:
    merchant = _merchant(session, "Solent Marketplace Ltd")
    first = monitoring.raise_alert(
        session,
        entity_id=merchant.entity_id,
        monitor_key="registry_change",
        severity="high",
        title="Duplicate probe",
        detail="probe",
        signals={"probe": True},
    )
    second = monitoring.raise_alert(
        session,
        entity_id=merchant.entity_id,
        monitor_key="registry_change",
        severity="high",
        title="Duplicate probe",
        detail="probe",
        signals={"probe": True},
    )
    assert first.id == second.id
    assert second.occurrences >= 2
