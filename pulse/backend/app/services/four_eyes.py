"""PLS-72 four-eyes as a platform primitive.

Dual authorisation is implemented once, here, and consumed by agent runs, brokered actions, policy
promotions and credit changes. Implementing it per use case is how organisations end up with four
subtly different definitions of "approved", only three of which are auditable.

The invariants are enforced, not documented:

* the approver is never the proposer or the requester (segregation of duties);
* the approver's role must carry approval rights for the decision class;
* the request and the decision both land in the hash-chained audit log.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ApprovalRequest, utcnow
from app.services import audit, entitlements


class ApprovalError(RuntimeError):
    """A dual-authorisation rule was violated."""


def request(
    session: Session,
    *,
    subject_type: str,
    subject_id: int | None,
    decision_class: str,
    action: str,
    proposer: str,
    proposer_role: str = "analyst",
    severity: str = "medium",
    required_role: str = "second_line",
    payload: dict[str, Any] | None = None,
) -> ApprovalRequest:
    row = ApprovalRequest(
        subject_type=subject_type,
        subject_id=subject_id,
        decision_class=decision_class,
        action=action,
        severity=severity,
        proposer=proposer,
        proposer_role=proposer_role,
        required_role=required_role,
        payload=audit.jsonable(payload or {}),
    )
    session.add(row)
    session.flush()
    audit.append(
        session,
        actor=proposer,
        actor_role=proposer_role,
        action="four_eyes.requested",
        subject_type="approval_request",
        subject_id=row.id,
        payload={
            "decision_class": decision_class,
            "action": action,
            "subject": f"{subject_type}:{subject_id}",
            "severity": severity,
        },
    )
    return row


def _require(session: Session, request_id: int) -> ApprovalRequest:
    row = session.get(ApprovalRequest, request_id)
    if row is None:
        raise LookupError(f"unknown approval request {request_id}")
    return row


def decide(
    session: Session,
    request_id: int,
    *,
    approver: str,
    approver_role: str,
    approve: bool,
    rationale: str,
    requester: str | None = None,
) -> ApprovalRequest:
    row = _require(session, request_id)
    if row.state != "pending":
        raise ApprovalError(f"approval request {request_id} is already {row.state}")
    entitlements.check_segregation(proposer=row.proposer, approver=approver, requester=requester)
    if not entitlements.may_approve(approver_role, row.decision_class):
        raise ApprovalError(
            f"role '{approver_role}' may not approve decision class '{row.decision_class}'"
        )
    if not rationale.strip():
        raise ApprovalError("an approval decision requires a rationale")

    row.state = "approved" if approve else "rejected"
    row.approver = approver
    row.rationale = rationale
    row.decided_at = utcnow()
    session.flush()
    audit.append(
        session,
        actor=approver,
        actor_role=approver_role,
        action=f"four_eyes.{row.state}",
        subject_type="approval_request",
        subject_id=row.id,
        payload={
            "decision_class": row.decision_class,
            "action": row.action,
            "proposer": row.proposer,
            "rationale": rationale,
        },
    )
    return row


def pending(session: Session, *, decision_class: str | None = None) -> list[dict[str, Any]]:
    stmt = select(ApprovalRequest).where(ApprovalRequest.state == "pending")
    if decision_class:
        stmt = stmt.where(ApprovalRequest.decision_class == decision_class)
    return [serialise(row) for row in session.execute(stmt.order_by(ApprovalRequest.id)).scalars()]


def approved_for(
    session: Session, *, subject_type: str, subject_id: int, action: str
) -> ApprovalRequest | None:
    """The approval a brokered action cites as its authority, if one exists."""
    return session.execute(
        select(ApprovalRequest)
        .where(
            ApprovalRequest.subject_type == subject_type,
            ApprovalRequest.subject_id == subject_id,
            ApprovalRequest.action == action,
            ApprovalRequest.state == "approved",
        )
        .order_by(ApprovalRequest.id.desc())
    ).scalars().first()


def serialise(row: ApprovalRequest) -> dict[str, Any]:
    return {
        "id": row.id,
        "subject_type": row.subject_type,
        "subject_id": row.subject_id,
        "decision_class": row.decision_class,
        "action": row.action,
        "severity": row.severity,
        "proposer": row.proposer,
        "proposer_role": row.proposer_role,
        "required_role": row.required_role,
        "state": row.state,
        "approver": row.approver,
        "rationale": row.rationale,
        "payload": row.payload,
        "created_at": row.created_at,
        "decided_at": row.decided_at,
    }
