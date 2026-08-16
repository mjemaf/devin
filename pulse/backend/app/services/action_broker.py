"""PLS-53 action broker: the only path to a consequential action on the outside world.

No component — human-driven or agentic — takes a consequential external action directly. Bypassing
the broker is a control failure, and it is *detectable*: :func:`reconcile` compares broker records
against observed state so an action that happened without a record shows up.

Every execution records the authority it acted under (a policy rule, a dual authorisation, or a
standing delegation), the evidence it relied on, whether it is reversible and, if so, a rollback
token with an expiry.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ApprovalRequest, BrokeredAction, Merchant, utcnow
from app.services import audit, events


class BrokerError(RuntimeError):
    """A refused action: missing authority, missing approval, or an unknown action type."""


# action -> (requires dual authorisation, reversible, rollback window in hours)
ACTIONS: dict[str, tuple[bool, bool, int]] = {
    "request_information": (False, True, 720),
    "add_case_note": (False, True, 24),
    "watch": (False, True, 720),
    "refresh_kyb": (False, True, 24),
    "reserve_increase": (True, True, 72),
    "limit_decrease": (True, True, 72),
    "restrict": (True, True, 24),
    "hold_funds": (True, True, 24),
    "approve_with_conditions": (True, False, 0),
    "approve": (True, False, 0),
    "decline": (True, False, 0),
    "terminate": (True, False, 0),
    "adverse_action_notice": (True, False, 0),
    "file_sar": (True, False, 0),
}


def execute(
    session: Session,
    *,
    action_type: str,
    entity_id: int | None,
    actor: str,
    actor_role: str = "analyst",
    actor_type: str = "human",
    authority_basis: str,
    rule_ref: str | None = None,
    rule_version: str | None = None,
    case_id: int | None = None,
    evidence: dict[str, Any] | None = None,
    approval_request_id: int | None = None,
) -> BrokeredAction:
    """Execute a consequential action, or refuse and say which control blocked it."""
    if action_type not in ACTIONS:
        raise BrokerError(f"unknown action type '{action_type}'; register it before use")
    needs_approval, reversible, window_hours = ACTIONS[action_type]

    if actor_type == "agent" and needs_approval and approval_request_id is None:
        raise BrokerError(
            f"'{action_type}' requires dual authorisation; an agent may not execute it unapproved"
        )
    if needs_approval:
        if approval_request_id is None:
            raise BrokerError(f"'{action_type}' requires an approved dual authorisation record")
        approval = session.get(ApprovalRequest, approval_request_id)
        if approval is None or approval.state != "approved":
            raise BrokerError(
                f"approval {approval_request_id} is not in an approved state for '{action_type}'"
            )
        if approval.action != action_type:
            raise BrokerError(
                f"approval {approval_request_id} authorises '{approval.action}', not '{action_type}'"
            )

    row = BrokeredAction(
        action_type=action_type,
        entity_id=entity_id,
        case_id=case_id,
        actor=actor,
        actor_type=actor_type,
        authority_basis=authority_basis,
        rule_ref=rule_ref,
        rule_version=rule_version,
        approval_request_id=approval_request_id,
        evidence=audit.jsonable(evidence or {}),
        reversible=reversible,
        rollback_token=str(uuid.uuid4()) if reversible else None,
        expires_at=utcnow() + dt.timedelta(hours=window_hours) if reversible else None,
    )
    session.add(row)
    session.flush()

    _apply(session, row)

    audit.append(
        session,
        actor=actor,
        actor_role=actor_role,
        action="action.executed",
        subject_type="brokered_action",
        subject_id=row.id,
        payload={
            "action_type": action_type,
            "entity_id": entity_id,
            "authority_basis": authority_basis,
            "rule_ref": rule_ref,
            "actor_type": actor_type,
            "reversible": reversible,
        },
    )
    events.publish(
        session,
        events.Event(
            name=events.ACTION_EXECUTED,
            subject_type="brokered_action",
            subject_id=row.id,
            payload={
                "action_type": action_type,
                "actor": actor,
                "actor_type": actor_type,
                "entity_id": entity_id,
                "authority_basis": authority_basis,
            },
        ),
        topic=events.ACTION_EXECUTED,
    )
    return row


def _apply(session: Session, row: BrokeredAction) -> None:
    """Effect the action on platform state. In production this calls the source system."""
    if row.entity_id is None:
        return
    merchant = session.execute(
        select(Merchant).where(Merchant.entity_id == row.entity_id)
    ).scalars().first()
    if merchant is None:
        return
    if row.action_type in {"restrict", "hold_funds"}:
        row.prior_state = merchant.lifecycle_state
        merchant.lifecycle_state = "restricted"
    elif row.action_type == "terminate":
        row.prior_state = merchant.lifecycle_state
        merchant.lifecycle_state = "terminated"
    session.flush()


def rollback(session: Session, *, rollback_token: str, actor: str, reason: str) -> BrokeredAction:
    row = session.execute(
        select(BrokeredAction).where(BrokeredAction.rollback_token == rollback_token)
    ).scalars().first()
    if row is None:
        raise LookupError(f"unknown rollback token {rollback_token}")
    if not row.reversible:
        raise BrokerError(f"'{row.action_type}' is not reversible")
    if row.state == "rolled_back":
        raise BrokerError(f"action {row.id} is already rolled back")
    if row.expires_at is not None and row.expires_at < utcnow():
        raise BrokerError(f"the rollback window for action {row.id} has expired")
    row.state = "rolled_back"
    row.rolled_back_by = actor
    row.rolled_back_at = utcnow()
    if row.entity_id is not None and row.action_type in {"restrict", "hold_funds"}:
        merchant = session.execute(
            select(Merchant).where(Merchant.entity_id == row.entity_id)
        ).scalars().first()
        if merchant is not None and merchant.lifecycle_state == "restricted":
            merchant.lifecycle_state = row.prior_state or "active"
    session.flush()
    audit.append(
        session,
        actor=actor,
        actor_role="analyst",
        action="action.rolled_back",
        subject_type="brokered_action",
        subject_id=row.id,
        payload={"action_type": row.action_type, "reason": reason},
    )
    return row


def reconcile(session: Session) -> dict[str, Any]:
    """Detect bypass: platform state that no brokered action accounts for."""
    brokered = session.execute(select(BrokeredAction)).scalars().all()
    accounted = {
        row.entity_id
        for row in brokered
        if row.state == "executed" and row.action_type in {"restrict", "hold_funds", "terminate"}
    }
    unexplained = [
        {"entity_id": merchant.entity_id, "state": merchant.lifecycle_state}
        for merchant in session.execute(
            select(Merchant).where(Merchant.lifecycle_state.in_(["restricted", "terminated"]))
        ).scalars()
        if merchant.entity_id not in accounted
    ]
    return {
        "brokered_actions": len(brokered),
        "unexplained_states": unexplained,
        "bypass_suspected": bool(unexplained),
    }


def ledger(session: Session, *, limit: int = 100) -> list[dict[str, Any]]:
    rows = session.execute(
        select(BrokeredAction).order_by(BrokeredAction.id.desc()).limit(limit)
    ).scalars().all()
    return [serialise(row) for row in rows]


def serialise(row: BrokeredAction) -> dict[str, Any]:
    return {
        "id": row.id,
        "action_type": row.action_type,
        "entity_id": row.entity_id,
        "case_id": row.case_id,
        "actor": row.actor,
        "actor_type": row.actor_type,
        "authority_basis": row.authority_basis,
        "rule_ref": row.rule_ref,
        "rule_version": row.rule_version,
        "approval_request_id": row.approval_request_id,
        "evidence": row.evidence,
        "state": row.state,
        "reversible": row.reversible,
        "rollback_token": row.rollback_token,
        "expires_at": row.expires_at,
        "rolled_back_by": row.rolled_back_by,
        "rolled_back_at": row.rolled_back_at,
        "created_at": row.created_at,
    }


def catalogue() -> list[dict[str, Any]]:
    return [
        {
            "action_type": action,
            "requires_dual_authorisation": needs_approval,
            "reversible": reversible,
            "rollback_window_hours": window,
        }
        for action, (needs_approval, reversible, window) in sorted(ACTIONS.items())
    ]
