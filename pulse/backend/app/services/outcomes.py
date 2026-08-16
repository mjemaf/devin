"""PLS-52 outcome and feedback: closing the loop that most platforms leave open.

A case that closes with free text teaches the platform nothing. Every disposition carries a label
(``confirmed`` | ``false_positive`` | ``explained``) that flows into three places: model and rule
evaluation (PLS-73), threshold tuning, and knowledge curation — a repeated ``explained`` outcome for
the same reason code is evidence that a rule is mis-specified, not that analysts are careless.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AgentRun, Alert, Case, OutcomeLabel
from app.services import audit, events

LABELS: tuple[str, ...] = ("confirmed", "false_positive", "explained")
EXIT_CLASSIFICATIONS: tuple[str, ...] = ("voluntary", "risk", "credit", "conduct", "commercial")


def label(
    session: Session,
    *,
    subject_type: str,
    subject_id: int,
    label: str,
    entity_id: int | None = None,
    exit_classification: str | None = None,
    predicted: str | None = None,
    observed: str | None = None,
    arp_key: str | None = None,
    note: str | None = None,
    labelled_by: str = "system",
) -> OutcomeLabel:
    if label not in LABELS:
        raise ValueError(f"outcome label must be one of {', '.join(LABELS)}")
    if exit_classification is not None and exit_classification not in EXIT_CLASSIFICATIONS:
        raise ValueError(f"exit classification must be one of {', '.join(EXIT_CLASSIFICATIONS)}")
    row = OutcomeLabel(
        subject_type=subject_type,
        subject_id=subject_id,
        entity_id=entity_id,
        label=label,
        exit_classification=exit_classification,
        predicted=predicted,
        observed=observed,
        arp_key=arp_key,
        note=note,
        labelled_by=labelled_by,
    )
    session.add(row)
    session.flush()
    audit.append(
        session,
        actor=labelled_by,
        actor_role="analyst",
        action="outcome.labelled",
        subject_type=subject_type,
        subject_id=subject_id,
        payload={
            "label": label,
            "entity_id": entity_id,
            "exit_classification": exit_classification,
            "arp_key": arp_key,
        },
    )
    events.publish(
        session,
        events.Event(
            name=events.OUTCOME_LABELLED,
            subject_type=subject_type,
            subject_id=subject_id,
            payload={
                "subject_type": subject_type,
                "subject_id": subject_id,
                "label": label,
                "entity_id": entity_id,
                "arp_key": arp_key,
            },
        ),
        topic=events.OUTCOME_LABELLED,
    )
    return row


def label_distribution(session: Session, *, arp_key: str | None = None) -> dict[str, int]:
    stmt = select(OutcomeLabel.label, func.count(OutcomeLabel.id)).group_by(OutcomeLabel.label)
    if arp_key:
        stmt = stmt.where(OutcomeLabel.arp_key == arp_key)
    return {str(name): int(count) for name, count in session.execute(stmt).all()}


def precision(session: Session, *, arp_key: str | None = None) -> float | None:
    """Confirmed / (confirmed + false positive) — the number that governs alert credibility."""
    distribution = label_distribution(session, arp_key=arp_key)
    confirmed = distribution.get("confirmed", 0)
    false_positive = distribution.get("false_positive", 0)
    total = confirmed + false_positive
    return round(confirmed / total, 4) if total else None


def alert_quality(session: Session) -> list[dict[str, Any]]:
    """Per-monitor precision, from labelled case outcomes — the input to threshold tuning."""
    rows = session.execute(
        select(Case.id, Case.case_type, Case.disposition).where(Case.disposition.is_not(None))
    ).all()
    by_monitor: dict[str, dict[str, int]] = {}
    for case_id, case_type, disposition in rows:
        monitor = str(case_type).removeprefix("monitoring_")
        bucket = by_monitor.setdefault(monitor, {"confirmed": 0, "false_positive": 0, "explained": 0})
        if disposition in bucket:
            bucket[str(disposition)] += 1
        _ = case_id
    out: list[dict[str, Any]] = []
    for monitor, counts in sorted(by_monitor.items()):
        decided = counts["confirmed"] + counts["false_positive"]
        out.append(
            {
                "monitor_key": monitor,
                **counts,
                "precision": round(counts["confirmed"] / decided, 4) if decided else None,
            }
        )
    return out


def unlabelled(session: Session) -> dict[str, Any]:
    """Closed work with no label is a broken feedback loop; surface it rather than tolerate it."""
    closed_unlabelled = session.execute(
        select(func.count()).select_from(Case).where(
            Case.status == "closed", Case.disposition.is_(None)
        )
    ).scalar_one()
    reviewed_runs = session.execute(
        select(func.count()).select_from(AgentRun).where(AgentRun.status.in_(["approved", "rejected"]))
    ).scalar_one()
    labelled_runs = session.execute(
        select(func.count(func.distinct(OutcomeLabel.subject_id))).where(
            OutcomeLabel.subject_type == "agent_run"
        )
    ).scalar_one()
    open_alerts = session.execute(
        select(func.count()).select_from(Alert).where(Alert.status == "open")
    ).scalar_one()
    return {
        "closed_cases_without_disposition": int(closed_unlabelled),
        "reviewed_agent_runs": int(reviewed_runs),
        "labelled_agent_runs": int(labelled_runs),
        "open_alerts": int(open_alerts),
    }
