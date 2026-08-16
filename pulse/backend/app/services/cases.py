"""Case management: the unit of human accountability.

Cases are how automation stays accountable — an agent recommendation without a case is an untracked
action. SLAs are derived from severity so that queue ageing is measurable.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Alert, Case, CaseEvent, Entity, ScreeningHit, utcnow
from app.services import audit, events

SLA_HOURS: dict[str, int] = {"critical": 4, "high": 24, "medium": 72, "low": 168}


def open_case(
    session: Session,
    *,
    entity_id: int,
    case_type: str,
    title: str,
    severity: str = "medium",
    created_by: str = "system",
    assignee: str | None = None,
    note: str | None = None,
    dedupe: bool = True,
) -> Case:
    if dedupe:
        existing = session.execute(
            select(Case).where(
                Case.entity_id == entity_id,
                Case.case_type == case_type,
                Case.status.in_(["open", "in_review", "pending_approval"]),
            )
        ).scalars().first()
        if existing is not None:
            add_event(session, existing.id, actor=created_by, action="duplicate_suppressed", note=title)
            return existing

    case = Case(
        entity_id=entity_id,
        case_type=case_type,
        title=title,
        severity=severity,
        created_by=created_by,
        assignee=assignee,
        sla_due_at=utcnow() + dt.timedelta(hours=SLA_HOURS.get(severity, 72)),
    )
    session.add(case)
    session.flush()
    add_event(session, case.id, actor=created_by, action="opened", note=note or title)
    audit.append(
        session,
        actor=created_by,
        action="case.opened",
        subject_type="case",
        subject_id=case.id,
        payload={"entity_id": entity_id, "case_type": case_type, "severity": severity, "title": title},
    )
    _publish_lifecycle(session, case, state="opened", actor=created_by)
    return case


def _publish_lifecycle(session: Session, case: Case, *, state: str, actor: str) -> None:
    events.publish(
        session,
        events.Event(
            name=events.CASE_LIFECYCLE,
            subject_type="case",
            subject_id=case.id,
            payload={
                "case_id": case.id,
                "state": state,
                "entity_id": case.entity_id,
                "case_type": case.case_type,
                "severity": case.severity,
                "actor": actor,
                "resolution": case.resolution,
            },
        ),
    )


def add_event(
    session: Session, case_id: int, *, actor: str, action: str, note: str | None = None
) -> CaseEvent:
    event = CaseEvent(case_id=case_id, actor=actor, action=action, note=note)
    session.add(event)
    session.flush()
    return event


def assign(session: Session, case_id: int, *, assignee: str, actor: str) -> Case:
    case = _require(session, case_id)
    case.assignee = assignee
    case.status = "in_review" if case.status == "open" else case.status
    session.flush()
    add_event(session, case_id, actor=actor, action="assigned", note=assignee)
    audit.append(
        session,
        actor=actor,
        actor_role="analyst",
        action="case.assigned",
        subject_type="case",
        subject_id=case_id,
        payload={"assignee": assignee},
    )
    _publish_lifecycle(session, case, state="assigned", actor=actor)
    return case


def close_case(
    session: Session, case_id: int, *, resolution: str, actor: str, note: str | None = None
) -> Case:
    case = _require(session, case_id)
    case.status = "closed"
    case.resolution = resolution
    case.closed_at = utcnow()
    session.flush()
    for alert in session.execute(select(Alert).where(Alert.case_id == case_id)).scalars():
        alert.status = "closed"
    add_event(session, case_id, actor=actor, action="closed", note=note or resolution)
    audit.append(
        session,
        actor=actor,
        actor_role="analyst",
        action="case.closed",
        subject_type="case",
        subject_id=case_id,
        payload={"resolution": resolution, "note": note},
    )
    _publish_lifecycle(session, case, state="closed", actor=actor)
    session.flush()
    return case


def _require(session: Session, case_id: int) -> Case:
    case = session.get(Case, case_id)
    if case is None:
        raise LookupError(f"unknown case {case_id}")
    return case


def case_detail(session: Session, case_id: int) -> dict[str, Any]:
    case = _require(session, case_id)
    entity = session.get(Entity, case.entity_id)
    events = session.execute(
        select(CaseEvent).where(CaseEvent.case_id == case_id).order_by(CaseEvent.created_at)
    ).scalars().all()
    alerts = session.execute(select(Alert).where(Alert.case_id == case_id)).scalars().all()
    hits = session.execute(
        select(ScreeningHit).where(ScreeningHit.entity_id == case.entity_id)
    ).scalars().all()
    return {
        "case": _serialise(case, entity),
        "events": [
            {
                "actor": event.actor,
                "action": event.action,
                "note": event.note,
                "at": event.created_at.isoformat(),
            }
            for event in events
        ],
        "alerts": [
            {
                "id": alert.id,
                "monitor_key": alert.monitor_key,
                "severity": alert.severity,
                "title": alert.title,
                "detail": alert.detail,
                "signals": alert.signals,
                "status": alert.status,
                "created_at": alert.created_at.isoformat(),
            }
            for alert in alerts
        ],
        "screening_hits": [
            {
                "id": hit.id,
                "list_type": hit.list_type,
                "list_name": hit.list_name,
                "matched_name": hit.matched_name,
                "score": hit.score,
                "disposition": hit.disposition,
                "detail": hit.detail,
                "demotions": hit.demotions,
                "reviewed_by": hit.reviewed_by,
            }
            for hit in hits
        ],
    }


def _serialise(case: Case, entity: Entity | None) -> dict[str, Any]:
    overdue = (
        case.sla_due_at is not None
        and case.status not in {"closed"}
        and case.sla_due_at.replace(tzinfo=dt.timezone.utc) < utcnow()
    )
    return {
        "id": case.id,
        "entity_id": case.entity_id,
        "entity_name": entity.legal_name if entity else None,
        "case_type": case.case_type,
        "title": case.title,
        "status": case.status,
        "severity": case.severity,
        "assignee": case.assignee,
        "created_by": case.created_by,
        "sla_due_at": case.sla_due_at.isoformat() if case.sla_due_at else None,
        "sla_breached": overdue,
        "resolution": case.resolution,
        "created_at": case.created_at.isoformat(),
        "closed_at": case.closed_at.isoformat() if case.closed_at else None,
    }


def list_cases(
    session: Session,
    *,
    status: str | None = None,
    severity: str | None = None,
    case_type: str | None = None,
    assignee: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    stmt = select(Case).order_by(Case.created_at.desc()).limit(limit)
    if case_type:
        stmt = stmt.where(Case.case_type == case_type)
    if status:
        stmt = stmt.where(Case.status == status)
    if severity:
        stmt = stmt.where(Case.severity == severity)
    if assignee:
        stmt = stmt.where(Case.assignee == assignee)
    cases = session.execute(stmt).scalars().all()
    return [_serialise(case, session.get(Entity, case.entity_id)) for case in cases]


def queue_stats(session: Session) -> dict[str, Any]:
    by_severity: dict[str, int] = dict(
        session.execute(
            select(Case.severity, func.count(Case.id))
            .where(Case.status != "closed")
            .group_by(Case.severity)
        )
        .tuples()
        .all()
    )
    by_type: dict[str, int] = dict(
        session.execute(
            select(Case.case_type, func.count(Case.id))
            .where(Case.status != "closed")
            .group_by(Case.case_type)
        )
        .tuples()
        .all()
    )
    open_cases = session.execute(select(Case).where(Case.status != "closed")).scalars().all()
    breached = [
        case.id
        for case in open_cases
        if case.sla_due_at is not None
        and case.sla_due_at.replace(tzinfo=dt.timezone.utc) < utcnow()
    ]
    closed = session.execute(select(Case).where(Case.status == "closed")).scalars().all()
    durations = [
        (case.closed_at - case.created_at).total_seconds() / 3600.0
        for case in closed
        if case.closed_at is not None
    ]
    return {
        "open": len(open_cases),
        "closed": len(closed),
        "by_severity": {str(k): int(v) for k, v in by_severity.items()},
        "by_type": {str(k): int(v) for k, v in by_type.items()},
        "sla_breached": breached,
        "median_hours_to_close": (
            round(sorted(durations)[len(durations) // 2], 2) if durations else None
        ),
    }
