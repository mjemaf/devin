"""Policy-as-code: safe evaluation, precedence, fail-closed behaviour and counterfactuals."""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest

from app.services import policy

CLEAN_FACTS: dict[str, Any] = {
    "entity.country": "GB",
    "resolution.review_required": False,
    "resolution.confidence": 0.99,
    "kyb.registry_status": "active",
    "kyb.unresolved_ownership_percentage": 0,
    "kyb.high_severity_mismatches": 0,
    "screening.sanctions_true_match": False,
    "screening.pep_exposure": False,
    "screening.adverse_media_score": 0.0,
    "network.linked_to_offboarded": False,
    "network.offboarded_path_strength": 0.0,
    "merchant.mcc": "5812",
    "merchant.expected_monthly_volume": 100_000,
    "credit.thin_file": False,
    "credit.credit_score": 70,
}


def test_clean_application_is_approved() -> None:
    evaluation = policy.evaluate("onboarding", CLEAN_FACTS)
    assert evaluation.outcome == "approve"
    assert evaluation.reason_codes == []
    assert all(result.error is None for result in evaluation.rule_results)


def test_sanctions_match_declines_and_stops_evaluation() -> None:
    evaluation = policy.evaluate(
        "onboarding", {**CLEAN_FACTS, "screening.sanctions_true_match": True}
    )
    assert evaluation.outcome == "decline"
    assert "SANCTIONS_MATCH" in {code["code"] for code in evaluation.reason_codes}
    # ``stop`` means later rules must not even be evaluated.
    evaluated = [result.rule_id for result in evaluation.rule_results]
    assert evaluated[-1] == "R-SANC-001"


def test_the_most_severe_outcome_wins_when_several_rules_fire() -> None:
    evaluation = policy.evaluate(
        "onboarding",
        {
            **CLEAN_FACTS,
            "credit.thin_file": True,
            "network.linked_to_offboarded": True,
            "network.offboarded_path_strength": 0.8,
        },
    )
    codes = {code["code"] for code in evaluation.reason_codes}
    assert "RELATED_TO_OFFBOARDED_ENTITY" in codes
    assert evaluation.outcome == "refer"
    assert evaluation.escalate_to == "financial_crime_investigations"


def test_a_missing_fact_fails_closed_rather_than_passing() -> None:
    facts = {key: value for key, value in CLEAN_FACTS.items() if key != "kyb.registry_status"}
    evaluation = policy.evaluate("onboarding", facts)
    assert evaluation.outcome in {"refer", "watch"}
    assert "POLICY_INPUT_MISSING" in {code["code"] for code in evaluation.reason_codes}
    assert any(result.error for result in evaluation.rule_results)


def test_counterfactuals_are_verified_not_asserted() -> None:
    evaluation = policy.evaluate(
        "onboarding",
        {
            **CLEAN_FACTS,
            "network.linked_to_offboarded": True,
            "network.offboarded_path_strength": 0.9,
        },
    )
    counterfactuals = [
        cf for cf in evaluation.counterfactuals if cf["reason_code"] == "RELATED_TO_OFFBOARDED_ENTITY"
    ]
    assert counterfactuals
    for cf in counterfactuals:
        probe = {**evaluation.features, cf["fact"]: cf["would_not_fire_if"]}
        rule = next(r for r in policy.get_pack("onboarding").rules if r.id == cf["rule_id"])
        assert policy.evaluate_expression(rule.when, probe) is False


def test_expression_evaluator_accepts_yaml_literals_and_rejects_arbitrary_code() -> None:
    assert policy.evaluate_expression("a == true", {"a": True}) is True
    assert policy.evaluate_expression("a not in ['active', None]", {"a": None}) is False
    assert policy.evaluate_expression("a not in ['active', None]", {"a": "dissolved"}) is True

    with pytest.raises(policy.PolicyError):
        policy.evaluate_expression("__import__('os').system('true')", {})
    with pytest.raises(policy.PolicyError):
        policy.evaluate_expression("unknown.fact == 1", {})


def test_packs_are_effective_dated() -> None:
    pack = policy.get_pack("onboarding")
    with pytest.raises(policy.PolicyError):
        policy.get_pack("onboarding", as_of=pack.effective_from - dt.timedelta(days=1))
    assert policy.get_pack("onboarding", as_of=pack.effective_from).version == pack.version


def test_geographies_are_added_by_overlay_not_by_forking_the_base_pack() -> None:
    facts = {**CLEAN_FACTS, "kyb.fca_authorised": False, "kyb.hmrc_msb_registered": False}

    globally = policy.evaluate("onboarding", facts, jurisdiction="US")
    assert globally.overlays == []
    assert globally.outcome == "approve"

    uk = policy.evaluate("onboarding", {**facts, "merchant.mcc": "6012"}, jurisdiction="GB")
    assert [o["pack"] for o in uk.overlays] == ["onboarding_uk"]
    assert uk.outcome == "refer"
    assert "UK_FCA_AUTHORISATION_UNVERIFIED" in {code["code"] for code in uk.reason_codes}

    # The same applicant outside the UK is not held to the UK addendum.
    assert policy.evaluate(
        "onboarding", {**facts, "merchant.mcc": "6012"}, jurisdiction="US"
    ).outcome == "approve"


def test_overlay_can_only_escalate_the_base_outcome() -> None:
    facts = {
        **CLEAN_FACTS,
        "kyb.fca_authorised": False,
        "kyb.hmrc_msb_registered": False,
        "screening.sanctions_true_match": True,
    }
    evaluation = policy.evaluate("onboarding", facts, jurisdiction="GB")
    assert evaluation.outcome == "decline"  # overlay refer must not soften a base decline


def test_uk_overlay_declines_an_unregistered_money_service_business() -> None:
    evaluation = policy.evaluate(
        "onboarding",
        {
            **CLEAN_FACTS,
            "merchant.mcc": "6051",
            "kyb.fca_authorised": True,
            "kyb.hmrc_msb_registered": False,
        },
        jurisdiction="GB",
    )
    assert evaluation.outcome == "decline"
    assert "UK_MSB_NOT_REGISTERED" in {code["code"] for code in evaluation.reason_codes}


def test_every_rule_carries_a_reason_code_and_an_sop_reference() -> None:
    for summary in policy.pack_summary():
        assert summary["pack"]
        assert summary["version"]
    for pack in policy.load_packs().values():
        for rule in pack.rules:
            assert rule.reason_code, f"{pack.pack}:{rule.id} has no reason code"
            assert rule.sop_ref, f"{pack.pack}:{rule.id} has no SOP reference"
            assert rule.outcome in pack.outcomes
