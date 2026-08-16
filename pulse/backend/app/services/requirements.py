"""PLS-54 requirement and request orchestration.

Most information requests to merchants fail for process reasons, not risk reasons: nobody tracked
what was asked, whether it arrived, whether it satisfied the requirement, or what happens when it
does not. This component makes an outstanding requirement a first-class object with a due date, an
escalation path and a consequence, and closes it only against received evidence.

Requests leave through the action broker (PLS-53), so an agent chasing a document is subject to the
same authority and logging as an analyst doing it.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EvidenceDocument, Requirement, utcnow
from app.services import action_broker, audit

# requirement -> (satisfying evidence types, default due days, consequence if unmet)
CATALOGUE: dict[str, tuple[tuple[str, ...], int, str]] = {
    "certificate_of_incorporation": (("registry_document",), 10, "boarding_blocked"),
    "ubo_declaration": (("declaration", "registry_document"), 10, "boarding_blocked"),
    "proof_of_identity": (("identity_document",), 7, "boarding_blocked"),
    "bank_statement": (("financial_statement",), 14, "credit_limit_frozen"),
    "financial_statements": (("financial_statement",), 21, "credit_limit_frozen"),
    "source_of_funds": (("declaration", "financial_statement"), 14, "restriction"),
    "business_model_explanation": (("declaration",), 7, "restriction"),
    "processing_history": (("statement",), 14, "credit_limit_frozen"),
}


class RequirementError(RuntimeError):
    """An unknown requirement, or a closure with no satisfying evidence."""


def raise_requirement(
    session: Session,
    *,
    entity_id: int,
    requirement_type: str,
    requested_by: str,
    case_id: int | None = None,
    due_days: int | None = None,
    rationale: str = "",
) -> Requirement:
    if requirement_type not in CATALOGUE:
        raise RequirementError(f"unknown requirement type '{requirement_type}'")
    evidence_types, default_due, consequence = CATALOGUE[requirement_type]
    row = Requirement(
        entity_id=entity_id,
        case_id=case_id,
        requirement_type=requirement_type,
        accepted_evidence=list(evidence_types),
        consequence=consequence,
        requested_by=requested_by,
        rationale=rationale,
        due_at=utcnow() + dt.timedelta(days=due_days or default_due),
    )
    session.add(row)
    session.flush()
    action_broker.execute(
        session,
        action_type="request_information",
        entity_id=entity_id,
        actor=requested_by,
        authority_basis=f"requirement:{requirement_type}",
        case_id=case_id,
        evidence={"requirement_id": row.id, "accepted_evidence": list(evidence_types)},
    )
    audit.append(
        session,
        actor=requested_by,
        actor_role="analyst",
        action="requirement.raised",
        subject_type="requirement",
        subject_id=row.id,
        payload={
            "entity_id": entity_id,
            "requirement_type": requirement_type,
            "due_at": row.due_at.isoformat(),
            "consequence": consequence,
        },
    )
    return row


def satisfy(
    session: Session,
    requirement_id: int,
    *,
    evidence_id: int,
    actor: str,
) -> Requirement:
    """Close a requirement against evidence that actually satisfies its accepted types."""
    row = session.get(Requirement, requirement_id)
    if row is None:
        raise LookupError(f"unknown requirement {requirement_id}")
    if row.state != "outstanding":
        raise RequirementError(f"requirement {requirement_id} is already {row.state}")
    evidence = session.get(EvidenceDocument, evidence_id)
    if evidence is None:
        raise LookupError(f"unknown evidence document {evidence_id}")
    if evidence.doc_type not in row.accepted_evidence:
        raise RequirementError(
            f"'{evidence.doc_type}' does not satisfy {row.requirement_type} "
            f"(accepted: {', '.join(row.accepted_evidence)})"
        )
    row.state = "satisfied"
    row.evidence_id = evidence_id
    row.satisfied_at = utcnow()
    row.satisfied_by = actor
    session.flush()
    audit.append(
        session,
        actor=actor,
        actor_role="analyst",
        action="requirement.satisfied",
        subject_type="requirement",
        subject_id=row.id,
        payload={
            "requirement_type": row.requirement_type,
            "evidence_id": evidence_id,
            "evidence_type": evidence.doc_type,
            "days_outstanding": round(
                (row.satisfied_at - row.created_at).total_seconds() / 86400, 2
            ),
        },
    )
    return row


def escalate_overdue(session: Session, *, actor: str = "system") -> list[dict[str, Any]]:
    """Apply the declared consequence to requirements that blew their due date."""
    now = utcnow()
    overdue = session.execute(
        select(Requirement).where(
            Requirement.state == "outstanding", Requirement.due_at < now
        )
    ).scalars().all()
    applied: list[dict[str, Any]] = []
    for row in overdue:
        row.state = "overdue"
        row.escalated_at = now
        session.flush()
        audit.append(
            session,
            actor=actor,
            actor_role="system",
            action="requirement.overdue",
            subject_type="requirement",
            subject_id=row.id,
            payload={
                "requirement_type": row.requirement_type,
                "entity_id": row.entity_id,
                "consequence": row.consequence,
            },
        )
        applied.append(
            {
                "requirement_id": row.id,
                "entity_id": row.entity_id,
                "requirement_type": row.requirement_type,
                "consequence": row.consequence,
            }
        )
    return applied


def outstanding(session: Session, *, entity_id: int | None = None) -> list[dict[str, Any]]:
    stmt = select(Requirement).where(Requirement.state.in_(["outstanding", "overdue"]))
    if entity_id is not None:
        stmt = stmt.where(Requirement.entity_id == entity_id)
    return [serialise(row) for row in session.execute(stmt.order_by(Requirement.due_at)).scalars()]


def blocking(session: Session, entity_id: int) -> list[str]:
    """Requirements that must be satisfied before the entity may be boarded."""
    return [
        row.requirement_type
        for row in session.execute(
            select(Requirement).where(
                Requirement.entity_id == entity_id,
                Requirement.state.in_(["outstanding", "overdue"]),
                Requirement.consequence == "boarding_blocked",
            )
        ).scalars()
    ]


def serialise(row: Requirement) -> dict[str, Any]:
    return {
        "id": row.id,
        "entity_id": row.entity_id,
        "case_id": row.case_id,
        "requirement_type": row.requirement_type,
        "accepted_evidence": row.accepted_evidence,
        "state": row.state,
        "consequence": row.consequence,
        "requested_by": row.requested_by,
        "rationale": row.rationale,
        "due_at": row.due_at,
        "created_at": row.created_at,
        "satisfied_at": row.satisfied_at,
        "satisfied_by": row.satisfied_by,
        "escalated_at": row.escalated_at,
        "evidence_id": row.evidence_id,
    }


def ageing(session: Session) -> dict[str, Any]:
    rows = session.execute(select(Requirement)).scalars().all()
    now = utcnow()
    return {
        "outstanding": sum(1 for row in rows if row.state == "outstanding"),
        "overdue": sum(1 for row in rows if row.state == "overdue"),
        "satisfied": sum(1 for row in rows if row.state == "satisfied"),
        "oldest_outstanding_days": max(
            (
                round((now - row.created_at).total_seconds() / 86400, 1)
                for row in rows
                if row.state in {"outstanding", "overdue"}
            ),
            default=0.0,
        ),
        "open_cases_with_requirements": len(
            {
                row.case_id
                for row in rows
                if row.case_id is not None and row.state in {"outstanding", "overdue"}
            }
        ),
    }
