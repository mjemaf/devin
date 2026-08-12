"""Agent oversight: data contracts, autonomy ceilings, four-eyes and promotion gates."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.services import agents

RECOMMENDATION = agents.Recommendation(
    action="escalate",
    confidence=0.81,
    rationale="Registry status conflicts with the application.",
    citations=[{"document": "POL-KYB-002", "section": "§4"}],
    decision_path=[{"step": "kyb", "finding": "status=dissolved"}],
    features={"kyb.registry_status": "dissolved"},
    models_consulted=["policy-pack:onboarding v4"],
)


def _register(session: Session, key: str, **overrides: object) -> object:
    kwargs: dict[str, object] = {
        "key": key,
        "task": "test pathway",
        "sop_refs": ["POL-TST-001 §1"],
        "data_contract": ["entity.*", "screening.hits"],
        "success_criteria": {"min_agreement": 0.95},
        "permitted_recommendations": ["escalate", "no_action", "decline"],
    }
    kwargs.update(overrides)
    return agents.register_arp(session, **kwargs)  # type: ignore[arg-type]


def test_shipped_arps_never_exceed_four_eyes_for_consequential_actions(session: Session) -> None:
    for key in ("boarding-triage", "screening-disposition", "monitoring-triage"):
        arp = agents.get_arp(session, key)
        assert arp.autonomy_ceiling == "four_eyes"
        assert agents.TIER_RANK[arp.autonomy_tier] <= agents.TIER_RANK[arp.autonomy_ceiling]


def test_a_pathway_cannot_register_above_its_own_ceiling(session: Session) -> None:
    with pytest.raises(agents.GovernanceError):
        _register(
            session,
            "test-over-ceiling",
            autonomy_tier="auto_bounded",
            autonomy_ceiling="four_eyes",
        )


def test_data_outside_the_contract_is_refused(session: Session) -> None:
    arp = _register(session, "test-data-contract")
    agents.enforce_data_contract(arp, ["entity.legal_name", "screening.hits"])  # type: ignore[arg-type]
    with pytest.raises(agents.DataContractViolation) as excinfo:
        agents.enforce_data_contract(arp, ["entity.legal_name", "credit.bureau_report"])  # type: ignore[arg-type]
    assert "credit.bureau_report" in str(excinfo.value)


def test_a_run_cannot_recommend_an_action_outside_its_pathway(session: Session) -> None:
    _register(session, "test-permitted")
    with pytest.raises(agents.GovernanceError):
        agents.run(
            session,
            arp_key="test-permitted",
            entity_id=1,
            recommendation=agents.Recommendation(
                action="terminate", confidence=0.99, rationale="not permitted"
            ),
            data_accessed=["entity.legal_name"],
        )


def test_the_kill_switch_stops_runs_and_drops_the_tier(session: Session) -> None:
    _register(session, "test-kill", autonomy_tier="suggest")
    arp = agents.set_kill_switch(
        session, "test-kill", engaged=True, actor="risk.owner@pulse.example", reason="drift observed"
    )
    assert arp.kill_switch_engaged is True
    assert arp.autonomy_tier == "shadow"
    with pytest.raises(agents.GovernanceError):
        agents.run(
            session,
            arp_key="test-kill",
            entity_id=1,
            recommendation=RECOMMENDATION,
            data_accessed=["entity.legal_name"],
        )


def test_releasing_the_kill_switch_restores_the_tier_the_arp_had_earned(session: Session) -> None:
    _register(session, "test-restore", autonomy_tier="suggest")
    agents.set_kill_switch(
        session, "test-restore", engaged=True, actor="risk.owner@pulse.example", reason="drift"
    )
    released = agents.set_kill_switch(
        session, "test-restore", engaged=False, actor="risk.owner@pulse.example", reason="fixed"
    )
    assert released.kill_switch_engaged is False
    assert released.autonomy_tier == "suggest"
    assert [entry["to"] for entry in released.tier_history] == ["shadow", "suggest"]


def test_materiality_caps_the_effective_tier_below_the_arp_tier(session: Session) -> None:
    _register(session, "test-materiality", autonomy_tier="suggest")
    run_ = agents.run(
        session,
        arp_key="test-materiality",
        entity_id=1,
        recommendation=RECOMMENDATION,
        data_accessed=["entity.legal_name"],
        materiality_permitted_tier="shadow",
    )
    assert run_.mode == "shadow"
    assert run_.status == "shadow_logged"


def test_shadow_runs_are_logged_but_not_surfaced_for_review(session: Session) -> None:
    _register(session, "test-shadow", autonomy_tier="shadow")
    run_ = agents.run(
        session,
        arp_key="test-shadow",
        entity_id=1,
        recommendation=RECOMMENDATION,
        data_accessed=["entity.legal_name"],
    )
    with pytest.raises(agents.GovernanceError):
        agents.review(session, run_.id, reviewer="analyst@pulse.example", outcome="escalate")


def test_an_outcome_needing_dual_authorisation_escalates_even_from_suggest(session: Session) -> None:
    _register(session, "test-dual", autonomy_tier="suggest")
    run_ = agents.run(
        session,
        arp_key="test-dual",
        entity_id=1,
        recommendation=RECOMMENDATION,
        data_accessed=["entity.legal_name"],
        requested_by="system",
    )
    assert run_.status == "pending_review"

    reviewed = agents.review(
        session, run_.id, reviewer="analyst@pulse.example", outcome="decline", note="dissolved"
    )
    assert reviewed.status == "pending_approval"

    with pytest.raises(agents.GovernanceError, match="four-eyes"):
        agents.approve(session, run_.id, approver="analyst@pulse.example")

    approved = agents.approve(session, run_.id, approver="second.line@pulse.example")
    assert approved.status == "approved"
    assert approved.second_approver == "second.line@pulse.example"


def test_a_reversible_agreed_outcome_needs_no_second_approver(session: Session) -> None:
    _register(session, "test-agreed", autonomy_tier="suggest")
    run_ = agents.run(
        session,
        arp_key="test-agreed",
        entity_id=1,
        recommendation=RECOMMENDATION,
        data_accessed=["entity.legal_name"],
    )
    reviewed = agents.review(session, run_.id, reviewer="analyst@pulse.example", outcome="escalate")
    assert reviewed.status == "approved"
    with pytest.raises(agents.GovernanceError):
        agents.approve(session, run_.id, approver="second.line@pulse.example")


def test_approval_requires_a_prior_first_line_review(session: Session) -> None:
    _register(session, "test-order", autonomy_tier="four_eyes", autonomy_ceiling="four_eyes")
    run_ = agents.run(
        session,
        arp_key="test-order",
        entity_id=1,
        recommendation=RECOMMENDATION,
        data_accessed=["entity.legal_name"],
    )
    assert run_.mode == "four_eyes"
    with pytest.raises(agents.GovernanceError, match="first-line"):
        agents.approve(session, run_.id, approver="second.line@pulse.example")


def test_promotion_is_blocked_until_volume_and_agreement_are_evidenced(session: Session) -> None:
    _register(session, "test-promotion", autonomy_tier="suggest", autonomy_ceiling="auto_bounded")
    readiness = agents.evaluate_arp(session, "test-promotion")
    assert readiness["next_tier"] == "four_eyes"
    assert readiness["promotion_ready"] is False
    assert any("reviewed runs" in blocker for blocker in readiness["blockers"])

    with pytest.raises(agents.GovernanceError, match="promotion criteria not met"):
        agents.set_tier(
            session,
            "test-promotion",
            tier="four_eyes",
            actor="risk.owner@pulse.example",
            rationale="looks fine",
        )


def test_promotion_beyond_the_ceiling_is_refused_however_good_the_metrics(session: Session) -> None:
    _register(session, "test-ceiling-promo", autonomy_tier="suggest", autonomy_ceiling="four_eyes")
    with pytest.raises(agents.GovernanceError, match="ceiling"):
        agents.set_tier(
            session,
            "test-ceiling-promo",
            tier="auto_bounded",
            actor="risk.owner@pulse.example",
            rationale="perfect agreement",
        )


def test_demotion_is_always_allowed_without_metrics(session: Session) -> None:
    _register(session, "test-demote", autonomy_tier="suggest")
    arp = agents.set_tier(
        session,
        "test-demote",
        tier="shadow",
        actor="risk.owner@pulse.example",
        rationale="post-incident precaution",
    )
    assert arp.autonomy_tier == "shadow"
    assert arp.tier_history[-1]["from"] == "suggest"


def test_severity_1_misses_block_promotion(session: Session) -> None:
    _register(
        session,
        "test-sev1",
        autonomy_tier="suggest",
        autonomy_ceiling="auto_bounded",
        permitted_recommendations=["approve", "escalate"],
    )
    run_ = agents.run(
        session,
        arp_key="test-sev1",
        entity_id=1,
        recommendation=agents.Recommendation(
            action="approve", confidence=0.9, rationale="looked clean"
        ),
        data_accessed=["entity.legal_name"],
    )
    agents.review(session, run_.id, reviewer="analyst@pulse.example", outcome="decline")
    readiness = agents.evaluate_arp(session, "test-sev1")
    assert readiness["severity_1_misses"] == [run_.id]
    assert any("severity-1" in blocker for blocker in readiness["blockers"])
