"""HTTP surface for the analyst console and partner integrations.

Thin by design: every endpoint delegates to a service and returns what that service produced, so
the API cannot become a second place where risk logic lives. Governance errors are translated to
409 (a refused action, not a bug) and lookups to 404.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.schemas import (
    AgentApproveIn,
    AgentReviewIn,
    ApplicationIn,
    ApproveDocumentIn,
    CaseAssignIn,
    CaseCloseIn,
    CaseNoteIn,
    DocumentIn,
    FeedbackIn,
    HitReviewIn,
    KillSwitchIn,
    ListUpdateIn,
    OffboardIn,
    PolicyEvalIn,
    QuestionIn,
    RegistryChangeIn,
    ScreenIn,
    TierIn,
    TransactionSignalIn,
)
from app.db import get_session
from app.models import (
    ARP,
    Alert,
    AuditEvent,
    Case,
    Decision,
    Document,
    DocumentVersion,
    Entity,
    KnowledgeQuery,
    Merchant,
    Monitor,
    ScreeningHit,
)
from app.providers import gateway
from app.services import (
    agents,
    audit,
    cases,
    decisioning,
    events,
    graph,
    knowledge,
    materiality,
    merchant360,
    monitoring,
    policy,
    scoring,
    screening,
)

router = APIRouter()


def _handled(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, agents.GovernanceError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, (ValueError, policy.PolicyError)):
        return HTTPException(status_code=400, detail=str(exc))
    raise exc


# ------------------------------------------------------------------------------------------
# Platform
# ------------------------------------------------------------------------------------------


@router.get("/health", tags=["platform"])
def health() -> dict[str, Any]:
    return {"status": "ok", "policy_packs": [pack["pack"] for pack in policy.pack_summary()]}


@router.get("/platform/overview", tags=["platform"])
def overview(session: Session = Depends(get_session)) -> dict[str, Any]:
    """The dashboard: portfolio shape, open work, automation posture and audit integrity."""
    merchants = session.execute(select(Merchant)).scalars().all()
    active = [m for m in merchants if m.lifecycle_state in {"boarded", "active"}]
    decisions = session.execute(
        select(Decision).order_by(Decision.as_of.desc()).limit(10)
    ).scalars().all()
    alerts = session.execute(select(Alert).where(Alert.status == "open")).scalars().all()
    return {
        "portfolio": {
            "merchants": len(merchants),
            "active": len(active),
            "terminated": sum(1 for m in merchants if m.lifecycle_state == "terminated"),
            "monthly_volume": round(sum(m.monthly_volume for m in active), 2),
            "exposure": round(sum(m.credit_limit for m in active), 2),
            "weighted_chargeback_rate": round(
                sum(m.chargeback_rate * m.monthly_volume for m in active)
                / max(sum(m.monthly_volume for m in active), 1.0),
                5,
            ),
        },
        "queues": cases.queue_stats(session),
        "alerts": {
            "open": len(alerts),
            "by_severity": {
                severity: sum(1 for a in alerts if a.severity == severity)
                for severity in {a.severity for a in alerts}
            },
        },
        "screening": {
            "actionable_hits": session.scalar(
                select(func.count())
                .select_from(ScreeningHit)
                .where(
                    ScreeningHit.disposition.in_(["potential_match", "true_match"]),
                    ScreeningHit.reviewed_by.is_(None),
                )
            ),
        },
        "automation": {
            "arps": [_serialise_arp(arp) for arp in session.execute(select(ARP)).scalars().all()],
            "pending_reviews": len(agents.review_queue(session, status="pending_review")),
            "pending_approvals": len(agents.review_queue(session, status="pending_approval")),
        },
        "recent_decisions": [
            {
                "id": d.id,
                "entity_id": d.entity_id,
                "outcome": d.outcome,
                "decision_type": d.decision_type,
                "policy": f"{d.policy_pack} v{d.policy_version}",
                "reason_codes": [r["code"] for r in d.reason_codes],
                "materiality": d.materiality,
                "as_of": d.as_of,
            }
            for d in decisions
        ],
        "cohorts": scoring.cohort_stats(session),
        "provider_spend": gateway.spend_report(session),
        "audit": audit.verify(session),
        "knowledge_gaps": [
            {"question": row.question, "top_score": row.top_score, "asked_by": row.asked_by}
            for row in knowledge.knowledge_gaps(session)
        ],
    }


@router.get("/platform/policies", tags=["platform"])
def policies() -> list[dict[str, Any]]:
    return policy.pack_summary()


@router.post("/platform/policies/evaluate", tags=["platform"])
def evaluate_policy(body: PolicyEvalIn) -> dict[str, Any]:
    """Replay a policy pack against arbitrary facts — the 'what would happen if' console."""
    try:
        evaluation = policy.evaluate(
            body.pack,
            dict(body.facts),
            as_of=body.as_of,
            jurisdiction=body.jurisdiction,
        )
    except Exception as exc:
        raise _handled(exc) from exc
    return evaluation.as_dict()


@router.get("/platform/materiality", tags=["platform"])
def materiality_matrix() -> dict[str, Any]:
    return {
        "never_automated": sorted(materiality.NEVER_AUTOMATED),
        "levels": materiality.LEVEL_AUTONOMY,
    }


# ------------------------------------------------------------------------------------------
# Boarding
# ------------------------------------------------------------------------------------------


@router.post("/boarding/applications", tags=["boarding"])
def board_application(
    body: ApplicationIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    application = body.model_dump(exclude={"actor", "jurisdiction"})
    try:
        return decisioning.board(
            session, application, actor=body.actor, jurisdiction=body.jurisdiction
        )
    except Exception as exc:
        raise _handled(exc) from exc


# ------------------------------------------------------------------------------------------
# Merchants / entities
# ------------------------------------------------------------------------------------------


@router.get("/merchants", tags=["merchants"])
def list_merchants(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    rows = session.execute(select(Merchant, Entity).join(Entity, Merchant.entity_id == Entity.id))
    out: list[dict[str, Any]] = []
    for merchant, entity in rows:
        latest = session.execute(
            select(Decision)
            .where(Decision.entity_id == entity.id)
            .order_by(Decision.as_of.desc())
        ).scalars().first()
        out.append(
            {
                "merchant_id": merchant.id,
                "entity_id": entity.id,
                "display_name": merchant.display_name,
                "legal_name": entity.legal_name,
                "country": entity.country,
                "segment": merchant.segment,
                "region": merchant.region,
                "mcc": merchant.mcc,
                "business_model": merchant.business_model,
                "lifecycle_state": merchant.lifecycle_state,
                "monthly_volume": merchant.monthly_volume,
                "chargeback_rate": merchant.chargeback_rate,
                "entity_status": entity.status,
                "latest_outcome": latest.outcome if latest else None,
                "open_alerts": session.scalar(
                    select(func.count())
                    .select_from(Alert)
                    .where(Alert.entity_id == entity.id, Alert.status == "open")
                ),
            }
        )
    return sorted(out, key=lambda row: row["display_name"])


@router.get("/merchants/{entity_id}", tags=["merchants"])
def merchant_profile(entity_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return merchant360.profile(session, entity_id)
    except Exception as exc:
        raise _handled(exc) from exc


@router.get("/merchants/{entity_id}/graph", tags=["merchants"])
def merchant_graph(
    entity_id: int,
    hops: int = Query(3, ge=1, le=5),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        return {
            "ownership": graph.ubo_graph(session, entity_id, max_hops=hops),
            "network": graph.link_analysis(session, entity_id, max_hops=min(hops, 3)),
        }
    except Exception as exc:
        raise _handled(exc) from exc


@router.post("/merchants/{entity_id}/screen", tags=["screening"])
def screen(
    entity_id: int, body: ScreenIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    try:
        return screening.screen_entity(
            session,
            entity_id,
            include_owners=body.include_owners,
            trigger=body.trigger,
            actor=body.actor,
        )
    except Exception as exc:
        raise _handled(exc) from exc


# ------------------------------------------------------------------------------------------
# Screening review
# ------------------------------------------------------------------------------------------


@router.get("/screening/hits", tags=["screening"])
def screening_hits(
    unreviewed_only: bool = True, session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    stmt = select(ScreeningHit, Entity).join(Entity, ScreeningHit.entity_id == Entity.id)
    if unreviewed_only:
        stmt = stmt.where(
            ScreeningHit.reviewed_by.is_(None),
            ScreeningHit.disposition.in_(["potential_match", "true_match"]),
        )
    return [
        {
            "hit_id": hit.id,
            "entity_id": hit.entity_id,
            "entity_name": entity.legal_name,
            "subject_entity_id": hit.subject_entity_id,
            "list_type": hit.list_type,
            "list_name": hit.list_name,
            "matched_name": hit.matched_name,
            "programme": hit.programme,
            "score": hit.score,
            "score_components": hit.score_components,
            "demotions": hit.demotions,
            "detail": hit.detail,
            "disposition": hit.disposition,
            "severity": screening.LIST_SEVERITY.get(hit.list_type, "low"),
            "reviewed_by": hit.reviewed_by,
            "review_rationale": hit.review_rationale,
            "trigger": hit.trigger,
            "created_at": hit.created_at,
        }
        for hit, entity in session.execute(stmt.order_by(ScreeningHit.score.desc()))
    ]


@router.post("/screening/hits/{hit_id}/review", tags=["screening"])
def review_hit(
    hit_id: int, body: HitReviewIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    try:
        hit = screening.review_hit(
            session,
            hit_id,
            disposition=body.disposition,
            rationale=body.rationale,
            reviewer=body.reviewer,
        )
    except Exception as exc:
        raise _handled(exc) from exc
    return {
        "hit_id": hit.id,
        "disposition": hit.disposition,
        "reviewed_by": hit.reviewed_by,
        "reviewed_at": hit.reviewed_at,
    }


# ------------------------------------------------------------------------------------------
# Knowledge & grounded policy Q&A
# ------------------------------------------------------------------------------------------


@router.post("/knowledge/ask", tags=["knowledge"])
def ask(body: QuestionIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    answer = knowledge.ask(
        session,
        body.question,
        as_of=body.as_of,
        asked_by=body.asked_by,
        jurisdictions=tuple(body.jurisdictions),
    )
    return answer.as_dict()


@router.get("/knowledge/documents", tags=["knowledge"])
def list_documents(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    documents = session.execute(select(Document).order_by(Document.key)).scalars().all()
    out: list[dict[str, Any]] = []
    for document in documents:
        versions = session.execute(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == document.id)
            .order_by(DocumentVersion.version)
        ).scalars().all()
        out.append(
            {
                "key": document.key,
                "title": document.title,
                "doc_type": document.doc_type,
                "jurisdiction": document.jurisdiction,
                "owner": document.owner,
                "versions": [
                    {
                        "version": version.version,
                        "status": version.status,
                        "effective_from": version.effective_from,
                        "effective_to": version.effective_to,
                        "checksum": version.checksum,
                        "approved_by": version.approved_by,
                    }
                    for version in versions
                ],
            }
        )
    return out


@router.post("/knowledge/documents", tags=["knowledge"])
def ingest_document(body: DocumentIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    version = knowledge.ingest_document(
        session,
        key=body.key,
        title=body.title,
        doc_type=body.doc_type,
        text=body.text,
        jurisdiction=body.jurisdiction,
        owner=body.owner,
        effective_from=body.effective_from,
        approve=body.approve,
        actor=body.actor,
    )
    return {
        "key": body.key,
        "version": version.version,
        "status": version.status,
        "effective_from": version.effective_from,
        "checksum": version.checksum,
    }


@router.post("/knowledge/documents/{key}/approve", tags=["knowledge"])
def approve_document(
    key: str, body: ApproveDocumentIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    try:
        version = knowledge.approve_version(
            session, document_key=key, version=body.version, actor=body.actor
        )
    except Exception as exc:
        raise _handled(exc) from exc
    return {
        "key": key,
        "version": version.version,
        "status": version.status,
        "approved_by": version.approved_by,
    }


@router.get("/knowledge/queries", tags=["knowledge"])
def knowledge_query_log(
    limit: int = 50, session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    rows = session.execute(
        select(KnowledgeQuery).order_by(KnowledgeQuery.created_at.desc()).limit(limit)
    ).scalars().all()
    return [
        {
            "id": row.id,
            "question": row.question,
            "grounded": row.grounded,
            "top_score": row.top_score,
            "citations": row.citations,
            "asked_by": row.asked_by,
            "as_of": row.as_of,
            "feedback": row.feedback,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.post("/knowledge/queries/{query_id}/feedback", tags=["knowledge"])
def knowledge_feedback(
    query_id: int, body: FeedbackIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    row = session.get(KnowledgeQuery, query_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"unknown query {query_id}")
    row.feedback = body.feedback
    session.flush()
    return {"id": row.id, "feedback": row.feedback}


# ------------------------------------------------------------------------------------------
# Cases
# ------------------------------------------------------------------------------------------


@router.get("/cases", tags=["cases"])
def list_cases(
    status: str | None = None,
    case_type: str | None = None,
    assignee: str | None = None,
    session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    return cases.list_cases(session, status=status, case_type=case_type, assignee=assignee)


@router.get("/cases/queue", tags=["cases"])
def case_queue(session: Session = Depends(get_session)) -> dict[str, Any]:
    return cases.queue_stats(session)


@router.get("/cases/{case_id}", tags=["cases"])
def case_detail(case_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return cases.case_detail(session, case_id)
    except Exception as exc:
        raise _handled(exc) from exc


@router.post("/cases/{case_id}/assign", tags=["cases"])
def assign_case(
    case_id: int, body: CaseAssignIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    try:
        case = cases.assign(session, case_id, assignee=body.assignee, actor=body.actor)
    except Exception as exc:
        raise _handled(exc) from exc
    return {"case_id": case.id, "status": case.status, "assignee": case.assignee}


@router.post("/cases/{case_id}/notes", tags=["cases"])
def add_case_note(
    case_id: int, body: CaseNoteIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    if session.get(Case, case_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown case {case_id}")
    event = cases.add_event(session, case_id, actor=body.actor, action="note", note=body.note)
    return {"case_id": case_id, "event_id": event.id, "note": event.note}


@router.post("/cases/{case_id}/close", tags=["cases"])
def close_case(
    case_id: int, body: CaseCloseIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    try:
        case = cases.close_case(
            session, case_id, resolution=body.resolution, actor=body.actor, note=body.note
        )
    except Exception as exc:
        raise _handled(exc) from exc
    return {"case_id": case.id, "status": case.status, "resolution": case.resolution}


# ------------------------------------------------------------------------------------------
# Monitoring
# ------------------------------------------------------------------------------------------


@router.get("/monitoring/monitors", tags=["monitoring"])
def list_monitors(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    return [
        {
            "key": monitor.key,
            "description": monitor.description,
            "cadence_days": monitor.cadence_days,
            "event_triggers": monitor.event_triggers,
            "enabled": monitor.enabled,
            "last_run_at": monitor.last_run_at,
        }
        for monitor in session.execute(select(Monitor).order_by(Monitor.key)).scalars().all()
    ]


@router.get("/monitoring/alerts", tags=["monitoring"])
def list_alerts(
    status: str | None = "open", session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    stmt = select(Alert, Entity).join(Entity, Alert.entity_id == Entity.id)
    if status:
        stmt = stmt.where(Alert.status == status)
    return [
        {
            "alert_id": alert.id,
            "entity_id": alert.entity_id,
            "entity_name": entity.legal_name,
            "monitor_key": alert.monitor_key,
            "severity": alert.severity,
            "title": alert.title,
            "detail": alert.detail,
            "signals": alert.signals,
            "status": alert.status,
            "case_id": alert.case_id,
            "occurrences": alert.occurrences,
            "created_at": alert.created_at,
            "last_seen_at": alert.last_seen_at,
        }
        for alert, entity in session.execute(stmt.order_by(Alert.last_seen_at.desc()))
    ]


@router.post("/monitoring/sweep", tags=["monitoring"])
def sweep(session: Session = Depends(get_session)) -> dict[str, Any]:
    return monitoring.sweep(session, actor="analyst@pulse.example")


@router.post("/monitoring/events/list-update", tags=["monitoring"])
def publish_list_update(
    body: ListUpdateIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Simulate a watchlist refresh: the whole active book is re-screened synchronously."""
    handled = events.publish(
        session,
        events.Event(
            name=events.SANCTIONS_LIST_UPDATED,
            subject_type="screening_list",
            payload={"list_name": body.list_name, "actor": body.actor},
        ),
    )
    return {"event": events.SANCTIONS_LIST_UPDATED, "handlers": handled}


@router.post("/monitoring/events/registry-change", tags=["monitoring"])
def publish_registry_change(
    body: RegistryChangeIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    if session.get(Entity, body.entity_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown entity {body.entity_id}")
    handled = events.publish(
        session,
        events.Event(
            name=events.REGISTRY_RECORD_CHANGED,
            subject_type="entity",
            subject_id=body.entity_id,
            payload={
                "entity_id": body.entity_id,
                "status": body.status,
                "detail": body.detail,
            },
        ),
    )
    return {"event": events.REGISTRY_RECORD_CHANGED, "handlers": handled}


@router.post("/monitoring/events/transaction-signal", tags=["monitoring"])
def publish_transaction_signal(
    body: TransactionSignalIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    if session.get(Merchant, body.merchant_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown merchant {body.merchant_id}")
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    handled = events.publish(
        session,
        events.Event(
            name=events.TRANSACTION_SIGNAL,
            subject_type="merchant",
            subject_id=body.merchant_id,
            payload=payload,
        ),
    )
    return {"event": events.TRANSACTION_SIGNAL, "handlers": handled}


@router.post("/monitoring/events/offboard", tags=["monitoring"])
def publish_offboard(body: OffboardIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    if session.get(Entity, body.entity_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown entity {body.entity_id}")
    handled = events.publish(
        session,
        events.Event(
            name=events.ENTITY_OFFBOARDED,
            subject_type="entity",
            subject_id=body.entity_id,
            payload={
                "entity_id": body.entity_id,
                "reason": body.reason,
                "actor": body.actor,
            },
        ),
    )
    return {"event": events.ENTITY_OFFBOARDED, "handlers": handled}


# ------------------------------------------------------------------------------------------
# Agent oversight
# ------------------------------------------------------------------------------------------


def _serialise_arp(arp: ARP) -> dict[str, Any]:
    return {
        "key": arp.key,
        "version": arp.version,
        "task": arp.task,
        "sop_refs": arp.sop_refs,
        "data_contract": arp.data_contract,
        "success_criteria": arp.success_criteria,
        "permitted_recommendations": arp.permitted_recommendations,
        "autonomy_tier": arp.autonomy_tier,
        "autonomy_ceiling": arp.autonomy_ceiling,
        "kill_switch_engaged": arp.kill_switch_engaged,
        "validated_by": arp.validated_by,
        "validated_at": arp.validated_at,
        "tier_history": arp.tier_history,
    }


@router.get("/agents/arps", tags=["agents"])
def list_arps(session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    return [
        _serialise_arp(arp)
        for arp in session.execute(select(ARP).order_by(ARP.key)).scalars().all()
    ]


@router.get("/agents/arps/{key}/evaluation", tags=["agents"])
def evaluate_arp(key: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return agents.evaluate_arp(session, key)
    except Exception as exc:
        raise _handled(exc) from exc


@router.post("/agents/arps/{key}/tier", tags=["agents"])
def set_tier(key: str, body: TierIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        arp = agents.set_tier(session, key, tier=body.tier, actor=body.actor, rationale=body.rationale)
    except Exception as exc:
        raise _handled(exc) from exc
    return _serialise_arp(arp)


@router.post("/agents/arps/{key}/kill-switch", tags=["agents"])
def kill_switch(
    key: str, body: KillSwitchIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    try:
        arp = agents.set_kill_switch(
            session, key, engaged=body.engaged, actor=body.actor, reason=body.reason
        )
    except Exception as exc:
        raise _handled(exc) from exc
    return _serialise_arp(arp)


@router.get("/agents/runs", tags=["agents"])
def agent_runs(
    status: str | None = None, session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    return agents.review_queue(session, status=status)


@router.post("/agents/runs/{run_id}/review", tags=["agents"])
def review_run(
    run_id: int, body: AgentReviewIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    try:
        agent_run = agents.review(
            session, run_id, reviewer=body.reviewer, outcome=body.outcome, note=body.note
        )
    except Exception as exc:
        raise _handled(exc) from exc
    return agents.serialise_run(agent_run)


@router.post("/agents/runs/{run_id}/approve", tags=["agents"])
def approve_run(
    run_id: int, body: AgentApproveIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    try:
        agent_run = agents.approve(session, run_id, approver=body.approver, note=body.note)
    except Exception as exc:
        raise _handled(exc) from exc
    return agents.serialise_run(agent_run)


# ------------------------------------------------------------------------------------------
# Audit
# ------------------------------------------------------------------------------------------


@router.get("/audit/verify", tags=["audit"])
def verify_chain(session: Session = Depends(get_session)) -> dict[str, Any]:
    return audit.verify(session)


@router.get("/audit/timeline/{entity_id}", tags=["audit"])
def entity_timeline(
    entity_id: int, limit: int = 200, session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    if session.get(Entity, entity_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown entity {entity_id}")
    return audit.entity_timeline(session, entity_id, limit=limit)


@router.get("/audit/export/{entity_id}", tags=["audit"])
def export_pack(entity_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    if session.get(Entity, entity_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown entity {entity_id}")
    return audit.export_entity_pack(session, entity_id)


@router.get("/audit/events", tags=["audit"])
def audit_events(
    limit: int = 100, session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    rows = session.execute(
        select(AuditEvent).order_by(AuditEvent.seq.desc()).limit(limit)
    ).scalars().all()
    return [
        {
            "seq": row.seq,
            "ts": row.ts,
            "actor": row.actor,
            "actor_role": row.actor_role,
            "action": row.action,
            "subject_type": row.subject_type,
            "subject_id": row.subject_id,
            "payload": row.payload,
            "hash": row.hash,
            "prev_hash": row.prev_hash,
        }
        for row in rows
    ]


@router.get("/audit/as-of", tags=["audit"])
def policy_as_of(
    question: str,
    as_of: dt.datetime,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Replay a policy question as at a past date — 'what did the rule say in February?'."""
    answer = knowledge.ask(session, question, as_of=as_of, asked_by="audit.replay")
    return answer.as_dict()
