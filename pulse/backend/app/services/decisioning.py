"""Boarding decisions: the end-to-end Know → Detect → Act path, once, for every channel.

One function assembles identity, KYB, ownership, screening, network, credit and score into a fact
set; policy-as-code turns that into an outcome; materiality decides how much autonomy is allowed;
and everything lands as a :class:`Decision` plus a case and agent run where humans are required.
Sales tools, the merchant portal and the analyst console all call this same path — that is what
stops "the same decision made three different ways".
"""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy.orm import Session

from app.models import Decision, Entity, Merchant, utcnow
from app.providers import gateway
from app.services import (
    agents,
    audit,
    cases,
    events,
    graph,
    kyb,
    materiality,
    policy,
    provenance,
    resolution,
    scoring,
    screening,
)

BOARDING_ARP = "boarding-triage"

CASE_TYPE_BY_OUTCOME = {
    "decline": "boarding_decline_review",
    "refer": "boarding_referral",
    "approve_with_conditions": "boarding_conditions_review",
}


def board(
    session: Session,
    application: dict[str, Any],
    *,
    actor: str = "system",
    jurisdiction: str = "global",
) -> dict[str, Any]:
    """Assess a merchant application. Returns the full explainable decision packet."""
    started = time.perf_counter()

    resolved = resolution.resolve(
        session,
        source_system=application.get("source_system", "application"),
        source_ref=application["application_id"],
        payload={
            "legal_name": application["legal_name"],
            "trading_name": application.get("trading_name"),
            "country": application.get("country"),
            "registration_number": application.get("registration_number"),
            "website": application.get("website"),
            "address": application.get("address"),
            "email": application.get("email"),
            "entity_type": "company",
        },
        actor=actor,
    )
    entity = session.get(Entity, resolved.entity_id)
    assert entity is not None

    kyb_result = kyb.verify(
        session,
        entity.id,
        applicant={
            "legal_name": application["legal_name"],
            "address": application.get("address"),
            "director_name": application.get("director_name"),
        },
        actor=actor,
    )
    screening_result = screening.screen_entity(
        session, entity.id, trigger="onboarding", actor=actor
    )
    ubo = graph.ubo_graph(session, entity.id)
    network = graph.link_analysis(session, entity.id)
    credit = gateway.call(
        session,
        provider="bureau",
        operation="credit_file",
        params={
            "country": entity.country,
            "registration_number": entity.registration_number,
        },
        entity_id=entity.id,
        requested_by=actor,
    ).data

    merchant = _upsert_merchant(session, entity, application)

    signals = scoring.build_signals(
        screening=screening_result,
        kyb={
            **kyb_result.as_dict(),
            "country": entity.country,
            "unresolved_ownership_percentage": max(
                kyb_result.unresolved_ownership_percentage,
                max(0.0, 100.0 - ubo["declared_ownership_percentage"]),
            ),
        },
        network=network,
        credit=credit,
        merchant=merchant,
    )
    score = scoring.score(
        session,
        entity.id,
        signals,
        cohort_key=f"{merchant.mcc}:{merchant.segment}",
    )

    offboarded_flags = [
        flag for flag in network["risk_flags"] if flag["flag"] == "linked_to_offboarded_entity"
    ]
    facts: dict[str, Any] = {
        "entity.country": entity.country,
        "resolution.review_required": resolved.review_required,
        "resolution.confidence": resolved.confidence,
        "kyb.registry_status": kyb_result.registry_status,
        "kyb.unresolved_ownership_percentage": signals["ubo_unresolved"] * 50.0,
        "kyb.high_severity_mismatches": sum(
            1 for m in kyb_result.mismatches if m.severity in {"high", "critical"}
        ),
        "screening.sanctions_true_match": screening_result["sanctions_true_match"],
        "screening.pep_exposure": screening_result["pep_exposure"],
        "screening.adverse_media_score": screening_result["adverse_media_score"],
        "network.linked_to_offboarded": bool(offboarded_flags),
        "network.offboarded_path_strength": max(
            (flag["path_strength"] for flag in offboarded_flags), default=0.0
        ),
        "merchant.mcc": merchant.mcc,
        "merchant.expected_monthly_volume": float(application.get("expected_monthly_volume") or 0.0),
        "credit.thin_file": bool(credit.get("thin_file")),
        "credit.credit_score": float(credit.get("credit_score") or 0.0),
        "kyb.fca_authorised": bool(kyb_result.verified_attributes.get("fca_authorised", False)),
        "kyb.hmrc_msb_registered": bool(
            kyb_result.verified_attributes.get("hmrc_msb_registered", False)
        ),
    }
    # An explicit jurisdiction wins; otherwise the entity's country selects the overlay, so a GB
    # applicant is assessed against the UK addendum without the caller having to know it exists.
    if jurisdiction == "global":
        jurisdiction = entity.country or "global"
    evaluation = policy.evaluate("onboarding", facts, jurisdiction=jurisdiction)

    exposure = float(application.get("expected_monthly_volume") or 0.0)
    consequence = materiality.assess(
        action=evaluation.outcome,
        financial_exposure=exposure,
        customers_affected=1,
        regulatory_notice_required=evaluation.outcome == "decline",
        sets_precedent=bool(offboarded_flags),
        risk_band=score.band,
    )

    staleness = provenance.staleness_report(session, entity.id)
    decision = Decision(
        entity_id=entity.id,
        decision_type="boarding",
        outcome=evaluation.outcome,
        policy_pack=evaluation.pack,
        policy_version=evaluation.version,
        rule_results=[r.as_dict() for r in evaluation.rule_results],
        reason_codes=evaluation.reason_codes,
        counterfactuals=evaluation.counterfactuals,
        materiality=consequence.level,
        required_oversight=consequence.permitted_autonomy,
        actor=actor,
        jurisdiction=jurisdiction,
        facts_relied=facts,
        fact_provenance=audit.jsonable(
            provenance.citation_bundle(session, entity.id, sorted(facts))
        ),
        model_versions=[
            f"{score.model_key} v{score.model_version}",
            f"{evaluation.pack} v{evaluation.version}",
        ],
        confidence=resolved.confidence,
        degraded_checks=staleness["by_freshness"]["stale"],
    )
    session.add(decision)
    session.flush()

    case = None
    agent_run = None
    case_type = CASE_TYPE_BY_OUTCOME.get(evaluation.outcome)
    if case_type is not None:
        severity = {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}[
            consequence.level
        ]
        case = cases.open_case(
            session,
            entity_id=entity.id,
            case_type=case_type,
            title=f"{evaluation.outcome.replace('_', ' ').title()}: {entity.legal_name}",
            severity=severity,
            created_by=actor,
            note="; ".join(reason["code"] for reason in evaluation.reason_codes) or None,
        )
        agent_run = _agent_recommendation(
            session,
            entity_id=entity.id,
            case_id=case.id,
            evaluation=evaluation,
            score=score,
            consequence=consequence,
            latency_ms=int((time.perf_counter() - started) * 1000),
            actor=actor,
        )
        decision.agent_run_id = agent_run.id
        session.flush()
    else:
        merchant.lifecycle_state = "boarded"
        merchant.boarded_at = utcnow()
        merchant.last_reviewed_at = utcnow()

    audit.append(
        session,
        actor=actor,
        action="decision.boarding",
        subject_type="decision",
        subject_id=decision.id,
        payload={
            "entity_id": entity.id,
            "outcome": evaluation.outcome,
            "policy": f"{evaluation.pack} v{evaluation.version}",
            "reason_codes": [reason["code"] for reason in evaluation.reason_codes],
            "risk_score": score.value,
            "risk_band": score.band,
            "materiality": consequence.level,
            "required_oversight": consequence.permitted_autonomy,
            "case_id": case.id if case else None,
            "agent_run_id": agent_run.id if agent_run else None,
        },
    )

    events.publish(
        session,
        events.Event(
            name=events.DECISION_RECORDED,
            subject_type="decision",
            subject_id=decision.id,
            payload={
                "entity_id": entity.id,
                "decision_type": "boarding",
                "outcome": evaluation.outcome,
                "policy": f"{evaluation.pack} v{evaluation.version}",
                "materiality": consequence.level,
                "required_oversight": consequence.permitted_autonomy,
                "case_id": case.id if case else None,
            },
        ),
    )

    return {
        "decision_id": decision.id,
        "entity_id": entity.id,
        "merchant_id": merchant.id,
        "outcome": evaluation.outcome,
        "conditions": evaluation.conditions,
        "escalate_to": evaluation.escalate_to,
        "materiality": consequence.as_dict(),
        "policy": {"pack": evaluation.pack, "version": evaluation.version},
        "reason_codes": evaluation.reason_codes,
        "rule_results": [r.as_dict() for r in evaluation.rule_results],
        "counterfactuals": evaluation.counterfactuals,
        "resolution": resolved.as_dict(),
        "kyb": kyb_result.as_dict(),
        "screening": screening_result,
        "ubo": ubo,
        "network": network,
        "credit": credit,
        "score": score.as_dict(),
        "case_id": case.id if case else None,
        "agent_run": agents.serialise_run(agent_run) if agent_run else None,
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }


def _upsert_merchant(session: Session, entity: Entity, application: dict[str, Any]) -> Merchant:
    merchant = next(iter(entity.merchants), None)
    if merchant is None:
        merchant = Merchant(entity_id=entity.id, display_name=entity.trading_name or entity.legal_name)
        session.add(merchant)
    merchant.segment = application.get("segment", merchant.segment or "smb")
    merchant.region = application.get("region", merchant.region or "EU")
    merchant.mcc = application.get("mcc") or merchant.mcc
    merchant.underwritten_mcc = merchant.underwritten_mcc or merchant.mcc
    merchant.business_model = application.get("business_model") or merchant.business_model
    merchant.underwritten_business_model = (
        merchant.underwritten_business_model or merchant.business_model
    )
    merchant.credit_limit = float(application.get("expected_monthly_volume") or 0.0)
    merchant.lifecycle_state = "underwriting"
    session.flush()
    return merchant


def _agent_recommendation(
    session: Session,
    *,
    entity_id: int,
    case_id: int,
    evaluation: policy.Evaluation,
    score: scoring.ScoreResult,
    consequence: materiality.Materiality,
    latency_ms: int,
    actor: str,
) -> Any:
    """The agent proposes the policy outcome with its trace; oversight decides what happens next."""
    action = {
        "decline": "decline",
        "refer": "escalate",
        "approve_with_conditions": "approve_with_conditions",
        "approve": "approve",
    }[evaluation.outcome]
    rationale_parts = [
        f"Policy {evaluation.pack} v{evaluation.version} returned '{evaluation.outcome}'.",
        *[
            f"{reason['code']}: {reason['text']} (rule {reason['rule_id']}, {reason['sop_ref']})"
            for reason in evaluation.reason_codes
        ],
        f"Risk score {score.value} ({score.band}); top drivers: "
        + ", ".join(c.signal for c in score.contributions[:3]),
    ]
    recommendation = agents.Recommendation(
        action=action,
        confidence=round(min(0.99, 0.6 + 0.05 * len(evaluation.reason_codes)), 2),
        rationale=" ".join(rationale_parts),
        citations=[
            {
                "type": "policy_rule",
                "rule_id": reason["rule_id"],
                "sop_ref": reason["sop_ref"],
                "reason_code": reason["code"],
            }
            for reason in evaluation.reason_codes
        ],
        decision_path=[r.as_dict() for r in evaluation.rule_results if r.fired],
        features=score.features,
        models_consulted=[f"{score.model_key} v{score.model_version}"],
    )
    return agents.run(
        session,
        arp_key=BOARDING_ARP,
        entity_id=entity_id,
        case_id=case_id,
        recommendation=recommendation,
        data_accessed=[
            "entity.resolved_profile",
            "facts.registry.status",
            "screening.hits",
            "graph.ownership",
            "scores.merchant_risk",
        ],
        materiality_permitted_tier=consequence.permitted_autonomy,
        latency_ms=latency_ms,
        requested_by=actor,
    )
