"""Agent oversight runtime: ARPs, the autonomy ladder, four-eyes review and evals.

This is the control plane the Agentic Oversight Framework asks for, implemented as code:

* An agent may only act inside a registered **ARP** (task, SOP refs, data contract, success
  criteria, permitted recommendations, autonomy tier, kill switch).
* Access to data is enforced against the ARP's declared ``data_contract`` — a request outside scope
  raises, it does not silently proceed.
* Promotion up the ladder (shadow → suggest → four_eyes → auto_bounded) is earned from measured
  agreement with human outcomes, and can never exceed the ARP's ceiling or the materiality of the
  action.
* Approval requires a second, different human; self-approval is rejected at the service layer.
"""

from __future__ import annotations

import datetime as dt
import fnmatch
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ARP, AgentRun, utcnow
from app.services import audit, materiality

TIERS = ("shadow", "suggest", "four_eyes", "auto_bounded")
TIER_RANK = {tier: index for index, tier in enumerate(TIERS)}

# Outcomes that need a second, different human whoever proposed them — agent or analyst.
DUAL_AUTHORISATION = frozenset(materiality.NEVER_AUTOMATED)


class GovernanceError(RuntimeError):
    """Raised when an agent action would breach its oversight envelope."""


class DataContractViolation(GovernanceError):
    pass


@dataclass
class Recommendation:
    action: str
    confidence: float
    rationale: str
    citations: list[dict[str, Any]] = field(default_factory=list)
    decision_path: list[dict[str, Any]] = field(default_factory=list)
    features: dict[str, Any] = field(default_factory=dict)
    models_consulted: list[str] = field(default_factory=list)


def register_arp(
    session: Session,
    *,
    key: str,
    task: str,
    sop_refs: list[str],
    data_contract: list[str],
    success_criteria: dict[str, Any],
    permitted_recommendations: list[str],
    autonomy_tier: str = "shadow",
    autonomy_ceiling: str = "four_eyes",
    validated_by: str | None = None,
) -> ARP:
    if autonomy_tier not in TIER_RANK or autonomy_ceiling not in TIER_RANK:
        raise GovernanceError("unknown autonomy tier")
    if TIER_RANK[autonomy_tier] > TIER_RANK[autonomy_ceiling]:
        raise GovernanceError(f"tier {autonomy_tier} exceeds ceiling {autonomy_ceiling}")

    existing = session.execute(select(ARP).where(ARP.key == key)).scalar()
    arp = existing or ARP(key=key)
    if existing is not None:
        arp.version += 1
    arp.task = task
    arp.sop_refs = sop_refs
    arp.data_contract = data_contract
    arp.success_criteria = success_criteria
    arp.permitted_recommendations = permitted_recommendations
    arp.autonomy_tier = autonomy_tier
    arp.autonomy_ceiling = autonomy_ceiling
    arp.validated_by = validated_by
    arp.validated_at = utcnow() if validated_by else None
    session.add(arp)
    session.flush()
    audit.append(
        session,
        actor=validated_by or "system",
        actor_role="risk_owner" if validated_by else "system",
        action="arp.registered",
        subject_type="arp",
        subject_id=arp.id,
        payload={
            "key": key,
            "version": arp.version,
            "autonomy_tier": autonomy_tier,
            "autonomy_ceiling": autonomy_ceiling,
            "data_contract": data_contract,
        },
    )
    return arp


def get_arp(session: Session, key: str) -> ARP:
    arp = session.execute(select(ARP).where(ARP.key == key)).scalar()
    if arp is None:
        raise GovernanceError(f"no ARP registered for {key!r}")
    return arp


def enforce_data_contract(arp: ARP, requested: list[str]) -> None:
    """Scoped data access: every requested field must match a data-contract pattern."""
    violations = [
        field_name
        for field_name in requested
        if not any(fnmatch.fnmatch(field_name, allowed) for allowed in arp.data_contract)
    ]
    if violations:
        raise DataContractViolation(
            f"ARP {arp.key} v{arp.version} may not access {', '.join(sorted(violations))}"
        )


def run(
    session: Session,
    *,
    arp_key: str,
    entity_id: int,
    recommendation: Recommendation,
    data_accessed: list[str],
    case_id: int | None = None,
    materiality_permitted_tier: str = "four_eyes",
    latency_ms: int = 0,
    requested_by: str = "system",
) -> AgentRun:
    """Record an agent run under its ARP, at the effective autonomy tier.

    The effective tier is the *minimum* of the ARP tier, the ARP ceiling and what the action's
    materiality permits — so a highly confident agent still cannot act above its consequence class.
    """
    arp = get_arp(session, arp_key)
    if arp.kill_switch_engaged:
        raise GovernanceError(f"ARP {arp_key} is disabled by kill switch")
    if recommendation.action not in arp.permitted_recommendations:
        raise GovernanceError(
            f"'{recommendation.action}' is not a permitted recommendation for {arp_key}"
        )
    enforce_data_contract(arp, data_accessed)

    effective_tier = min(
        (arp.autonomy_tier, arp.autonomy_ceiling, materiality_permitted_tier),
        key=lambda tier: TIER_RANK[tier],
    )
    status = {
        "shadow": "shadow_logged",
        "suggest": "pending_review",
        "four_eyes": "pending_approval",
        "auto_bounded": "auto_executed",
    }[effective_tier]

    agent_run = AgentRun(
        arp_key=arp.key,
        arp_version=arp.version,
        entity_id=entity_id,
        case_id=case_id,
        mode=effective_tier,
        recommendation=recommendation.action,
        confidence=recommendation.confidence,
        rationale=recommendation.rationale,
        citations=recommendation.citations,
        decision_path=recommendation.decision_path,
        features=recommendation.features,
        data_accessed=data_accessed,
        models_consulted=recommendation.models_consulted,
        status=status,
        requested_by=requested_by,
        latency_ms=latency_ms,
    )
    session.add(agent_run)
    session.flush()
    audit.append(
        session,
        actor=f"agent:{arp.key}",
        actor_role="agent",
        action="agent.run",
        subject_type="agent_run",
        subject_id=agent_run.id,
        payload={
            "arp": arp.key,
            "arp_version": arp.version,
            "entity_id": entity_id,
            "mode": effective_tier,
            "recommendation": recommendation.action,
            "confidence": recommendation.confidence,
            "materiality_permitted_tier": materiality_permitted_tier,
            "data_accessed": data_accessed,
            "citations": recommendation.citations,
            "visible_to_analyst": effective_tier != "shadow",
        },
    )
    return agent_run


def review(
    session: Session,
    run_id: int,
    *,
    reviewer: str,
    outcome: str,
    note: str | None = None,
) -> AgentRun:
    """First-line human decision on an agent recommendation (records agreement for evals).

    A run goes to second-line approval either because its tier demands it, or because the human
    landed on an outcome that always needs dual authorisation — segregation of duties attaches to
    the consequence of the action, not to who proposed it.
    """
    agent_run = _require_run(session, run_id)
    if agent_run.mode == "shadow":
        raise GovernanceError("shadow runs are not surfaced for review")
    if agent_run.status in {"approved", "rejected"}:
        raise GovernanceError(f"run {run_id} is already {agent_run.status}")
    agent_run.reviewer = reviewer
    agent_run.reviewed_at = utcnow()
    agent_run.review_note = note
    agent_run.human_outcome = outcome
    needs_approval = agent_run.mode == "four_eyes" or outcome in DUAL_AUTHORISATION
    agent_run.status = (
        "pending_approval"
        if needs_approval
        else ("approved" if outcome == agent_run.recommendation else "rejected")
    )
    session.flush()
    audit.append(
        session,
        actor=reviewer,
        actor_role="analyst",
        action="agent.reviewed",
        subject_type="agent_run",
        subject_id=run_id,
        payload={
            "recommendation": agent_run.recommendation,
            "human_outcome": outcome,
            "agreed": outcome == agent_run.recommendation,
            "note": note,
            "status": agent_run.status,
            "dual_authorisation_required": needs_approval,
        },
    )
    return agent_run


def approve(
    session: Session, run_id: int, *, approver: str, note: str | None = None
) -> AgentRun:
    """Second-line approval. Segregation of duties is enforced here, not by convention."""
    agent_run = _require_run(session, run_id)
    if agent_run.reviewer is None:
        raise GovernanceError("run has not been reviewed by a first-line analyst yet")
    if agent_run.status != "pending_approval":
        raise GovernanceError(f"run {run_id} does not require second-line approval")
    if agent_run.reviewer == approver:
        raise GovernanceError(
            "four-eyes breach: the approver must be a different person from the reviewer"
        )
    if agent_run.requested_by == approver:
        raise GovernanceError("four-eyes breach: the requester may not approve their own request")
    agent_run.second_approver = approver
    agent_run.status = "approved"
    session.flush()
    audit.append(
        session,
        actor=approver,
        actor_role="approver",
        action="agent.approved",
        subject_type="agent_run",
        subject_id=run_id,
        payload={
            "reviewer": agent_run.reviewer,
            "approver": approver,
            "human_outcome": agent_run.human_outcome,
            "note": note,
        },
    )
    return agent_run


def _require_run(session: Session, run_id: int) -> AgentRun:
    agent_run = session.get(AgentRun, run_id)
    if agent_run is None:
        raise LookupError(f"unknown agent run {run_id}")
    return agent_run


def evaluate_arp(session: Session, arp_key: str) -> dict[str, Any]:
    """Backtest an ARP against human outcomes and report promotion readiness."""
    settings = get_settings()
    arp = get_arp(session, arp_key)
    runs = session.execute(
        select(AgentRun).where(AgentRun.arp_key == arp_key, AgentRun.human_outcome.isnot(None))
    ).scalars().all()

    reviewed = len(runs)
    agreed = sum(1 for run_ in runs if run_.human_outcome == run_.recommendation)
    agreement = round(agreed / reviewed, 4) if reviewed else 0.0
    # A severity-1 miss: the agent proposed a permissive action where the human escalated/blocked.
    severity_1_misses = [
        run_.id
        for run_ in runs
        if run_.recommendation in {"approve", "no_action", "close"}
        and run_.human_outcome in {"decline", "escalate", "hold_funds", "terminate", "refer"}
    ]
    latencies = sorted(run_.latency_ms for run_ in runs) or [0]
    p95 = latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))]

    current_rank = TIER_RANK[arp.autonomy_tier]
    next_tier = TIERS[current_rank + 1] if current_rank + 1 < len(TIERS) else None
    required_agreement = {
        "suggest": settings.suggest_min_agreement,
        "four_eyes": settings.four_eyes_min_agreement,
        "auto_bounded": settings.four_eyes_min_agreement,
    }.get(next_tier or "", 1.0)

    blockers: list[str] = []
    if next_tier is None:
        blockers.append("already at the top of the ladder")
    else:
        if TIER_RANK[next_tier] > TIER_RANK[arp.autonomy_ceiling]:
            blockers.append(f"ceiling {arp.autonomy_ceiling} prevents promotion to {next_tier}")
        if reviewed < settings.shadow_min_cases:
            blockers.append(
                f"{reviewed} reviewed runs, {settings.shadow_min_cases} required for promotion"
            )
        if agreement < required_agreement:
            blockers.append(
                f"agreement {agreement:.2%} below the {required_agreement:.2%} bar for {next_tier}"
            )
        if severity_1_misses:
            blockers.append(f"{len(severity_1_misses)} severity-1 miss(es) must be zero")

    return {
        "arp": arp.key,
        "version": arp.version,
        "autonomy_tier": arp.autonomy_tier,
        "autonomy_ceiling": arp.autonomy_ceiling,
        "kill_switch_engaged": arp.kill_switch_engaged,
        "reviewed_runs": reviewed,
        "agreement_rate": agreement,
        "severity_1_misses": severity_1_misses,
        "p95_latency_ms": p95,
        "next_tier": next_tier,
        "promotion_ready": next_tier is not None and not blockers,
        "blockers": blockers,
        "success_criteria": arp.success_criteria,
    }


def set_tier(session: Session, arp_key: str, *, tier: str, actor: str, rationale: str) -> ARP:
    if tier not in TIER_RANK:
        raise GovernanceError(f"unknown tier {tier}")
    arp = get_arp(session, arp_key)
    if TIER_RANK[tier] > TIER_RANK[arp.autonomy_ceiling]:
        raise GovernanceError(f"tier {tier} exceeds the ARP ceiling {arp.autonomy_ceiling}")
    if TIER_RANK[tier] > TIER_RANK[arp.autonomy_tier]:
        readiness = evaluate_arp(session, arp_key)
        if readiness["next_tier"] != tier or not readiness["promotion_ready"]:
            raise GovernanceError(
                "promotion criteria not met: " + "; ".join(readiness["blockers"])
            )
    previous = arp.autonomy_tier
    arp.autonomy_tier = tier
    arp.tier_history = [
        *(arp.tier_history or []),
        {
            "from": previous,
            "to": tier,
            "actor": actor,
            "rationale": rationale,
            "at": dt.datetime.now(dt.timezone.utc).isoformat(),
        },
    ]
    session.flush()
    audit.append(
        session,
        actor=actor,
        actor_role="risk_owner",
        action="arp.tier_changed",
        subject_type="arp",
        subject_id=arp.id,
        payload={"from": previous, "to": tier, "rationale": rationale},
    )
    return arp


def _tier_before_kill_switch(arp: ARP) -> str | None:
    """The tier the ARP held when the kill switch was last engaged, so releasing it restores the
    earned tier instead of leaving the process silently demoted for ever."""
    for entry in reversed(arp.tier_history or []):
        if entry.get("kill_switch") and entry.get("engaged"):
            demoted_from = entry.get("from")
            return demoted_from if isinstance(demoted_from, str) else None
    return None


def set_kill_switch(session: Session, arp_key: str, *, engaged: bool, actor: str, reason: str) -> ARP:
    arp = get_arp(session, arp_key)
    previous = arp.autonomy_tier
    arp.kill_switch_engaged = engaged
    if engaged:
        arp.autonomy_tier = "shadow"
    else:
        arp.autonomy_tier = _tier_before_kill_switch(arp) or arp.autonomy_tier
    if arp.autonomy_tier != previous:
        arp.tier_history = [
            *(arp.tier_history or []),
            {
                "from": previous,
                "to": arp.autonomy_tier,
                "actor": actor,
                "rationale": f"kill switch {'engaged' if engaged else 'released'}: {reason}",
                "at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "kill_switch": True,
                "engaged": engaged,
            },
        ]
    session.flush()
    audit.append(
        session,
        actor=actor,
        actor_role="risk_owner",
        action="arp.kill_switch",
        subject_type="arp",
        subject_id=arp.id,
        payload={"engaged": engaged, "reason": reason, "autonomy_tier": arp.autonomy_tier},
    )
    return arp


def serialise_run(agent_run: AgentRun) -> dict[str, Any]:
    return {
        "id": agent_run.id,
        "arp_key": agent_run.arp_key,
        "arp_version": agent_run.arp_version,
        "entity_id": agent_run.entity_id,
        "case_id": agent_run.case_id,
        "mode": agent_run.mode,
        "recommendation": agent_run.recommendation,
        "confidence": agent_run.confidence,
        "rationale": agent_run.rationale,
        "citations": agent_run.citations,
        "decision_path": agent_run.decision_path,
        "data_accessed": agent_run.data_accessed,
        "models_consulted": agent_run.models_consulted,
        "status": agent_run.status,
        "reviewer": agent_run.reviewer,
        "second_approver": agent_run.second_approver,
        "human_outcome": agent_run.human_outcome,
        "review_note": agent_run.review_note,
        "created_at": agent_run.created_at.isoformat(),
    }


def review_queue(session: Session, *, status: str | None = None) -> list[dict[str, Any]]:
    stmt = select(AgentRun).order_by(AgentRun.created_at.desc())
    if status:
        stmt = stmt.where(AgentRun.status == status)
    else:
        stmt = stmt.where(AgentRun.status.in_(["pending_review", "pending_approval"]))
    return [serialise_run(run_) for run_ in session.execute(stmt).scalars()]
