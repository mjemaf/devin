"""Merchant 360: one assembled view of everything the platform knows, with provenance.

Deliberately assembled from the same primitives the decision path uses — facts, ownership,
screening, scores, decisions, alerts, cases and audit — rather than a separate denormalised store,
so the console can never show something a decision did not see.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Alert,
    Case,
    Decision,
    Entity,
    Merchant,
    Score,
    ScreeningHit,
    SourceRecord,
)
from app.services import graph, kyb
from app.services.audit import entity_timeline


def profile(session: Session, entity_id: int) -> dict[str, Any]:
    entity = session.get(Entity, entity_id)
    if entity is None:
        raise LookupError(f"unknown entity {entity_id}")
    merchant = session.execute(
        select(Merchant).where(Merchant.entity_id == entity_id)
    ).scalars().first()

    facts = kyb.effective_facts(session, entity_id)
    latest_score = session.execute(
        select(Score).where(Score.entity_id == entity_id).order_by(Score.as_of.desc())
    ).scalars().first()
    decisions = session.execute(
        select(Decision).where(Decision.entity_id == entity_id).order_by(Decision.as_of.desc())
    ).scalars().all()
    hits = session.execute(
        select(ScreeningHit).where(ScreeningHit.entity_id == entity_id)
    ).scalars().all()
    alerts = session.execute(
        select(Alert).where(Alert.entity_id == entity_id).order_by(Alert.created_at.desc())
    ).scalars().all()
    open_cases = session.execute(
        select(Case).where(Case.entity_id == entity_id).order_by(Case.created_at.desc())
    ).scalars().all()
    sources = session.execute(
        select(SourceRecord).where(SourceRecord.resolved_entity_id == entity_id)
    ).scalars().all()

    ubo = graph.ubo_graph(session, entity_id)
    network = graph.link_analysis(session, entity_id)

    return {
        "entity": {
            "id": entity.id,
            "legal_name": entity.legal_name,
            "trading_name": entity.trading_name,
            "entity_type": entity.entity_type,
            "country": entity.country,
            "registration_number": entity.registration_number,
            "website": entity.website,
            "address": entity.address,
            "status": entity.status,
            "offboarded_reason": entity.offboarded_reason,
            "resolution_confidence": entity.resolution_confidence,
        },
        "merchant": None
        if merchant is None
        else {
            "id": merchant.id,
            "display_name": merchant.display_name,
            "segment": merchant.segment,
            "region": merchant.region,
            "mcc": merchant.mcc,
            "underwritten_mcc": merchant.underwritten_mcc,
            "business_model": merchant.business_model,
            "underwritten_business_model": merchant.underwritten_business_model,
            "lifecycle_state": merchant.lifecycle_state,
            "monthly_volume": merchant.monthly_volume,
            "chargeback_rate": merchant.chargeback_rate,
            "reserve_held": merchant.reserve_held,
            "credit_limit": merchant.credit_limit,
            "boarded_at": merchant.boarded_at.isoformat() if merchant.boarded_at else None,
            "last_reviewed_at": (
                merchant.last_reviewed_at.isoformat() if merchant.last_reviewed_at else None
            ),
            "review_cadence_days": merchant.review_cadence_days,
        },
        "identity": {
            "source_records": [
                {
                    "source_system": record.source_system,
                    "source_ref": record.source_ref,
                    "match_confidence": record.match_confidence,
                    "match_method": record.match_method,
                    "match_contributions": record.match_contributions,
                    "review_required": record.review_required,
                    "payload": record.payload,
                }
                for record in sources
            ]
        },
        "facts": {
            attribute: {
                "value": detail["value"],
                "source": detail["source"],
                "confidence": detail["confidence"],
                "as_of": detail["as_of"].isoformat(),
            }
            for attribute, detail in sorted(facts.items())
        },
        "ownership": ubo,
        "network": network,
        "screening": [
            {
                "id": hit.id,
                "subject_entity_id": hit.subject_entity_id,
                "list_type": hit.list_type,
                "list_name": hit.list_name,
                "matched_name": hit.matched_name,
                "programme": hit.programme,
                "score": hit.score,
                "score_components": hit.score_components,
                "demotions": hit.demotions,
                "disposition": hit.disposition,
                "detail": hit.detail,
                "reviewed_by": hit.reviewed_by,
                "trigger": hit.trigger,
            }
            for hit in sorted(hits, key=lambda h: -h.score)
        ],
        "score": None
        if latest_score is None
        else {
            "model_key": latest_score.model_key,
            "model_version": latest_score.model_version,
            "value": latest_score.value,
            "band": latest_score.band,
            "peer_percentile": latest_score.peer_percentile,
            "contributions": latest_score.contributions,
            "features": latest_score.features,
            "inputs_hash": latest_score.inputs_hash,
            "as_of": latest_score.as_of.isoformat(),
        },
        "decisions": [
            {
                "id": decision.id,
                "decision_type": decision.decision_type,
                "outcome": decision.outcome,
                "policy": f"{decision.policy_pack} v{decision.policy_version}",
                "reason_codes": decision.reason_codes,
                "counterfactuals": decision.counterfactuals,
                "materiality": decision.materiality,
                "required_oversight": decision.required_oversight,
                "agent_run_id": decision.agent_run_id,
                "as_of": decision.as_of.isoformat(),
            }
            for decision in decisions
        ],
        "alerts": [
            {
                "id": alert.id,
                "monitor_key": alert.monitor_key,
                "severity": alert.severity,
                "title": alert.title,
                "detail": alert.detail,
                "status": alert.status,
                "case_id": alert.case_id,
                "occurrences": alert.occurrences,
                "created_at": alert.created_at.isoformat(),
                "last_seen_at": alert.last_seen_at.isoformat(),
            }
            for alert in alerts
        ],
        "cases": [
            {
                "id": case.id,
                "case_type": case.case_type,
                "title": case.title,
                "status": case.status,
                "severity": case.severity,
                "assignee": case.assignee,
                "created_at": case.created_at.isoformat(),
            }
            for case in open_cases
        ],
        "timeline": entity_timeline(session, entity_id),
    }
