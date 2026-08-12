"""The boarding path: one Know → Detect → Act traversal, fully explainable."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Case, Decision, Entity, Merchant
from app.services import audit, decisioning

CLEAN_APPLICATION = {
    "application_id": "APP-TEST-3001",
    "legal_name": "Northwind Retail Limited",
    "trading_name": "Northwind Test",
    "country": "GB",
    "registration_number": "09112233",
    "address": "18 Kingsway, London, WC2B 6UN, GB",
    "director_name": "Sarah Whitfield",
    "mcc": "5691",
    "business_model": "apparel_retail",
    "expected_monthly_volume": 40_000.0,
}

DISSOLVED_APPLICATION = {
    "application_id": "APP-TEST-3002",
    "legal_name": "Meridian Wellness Ltd",
    "country": "GB",
    "registration_number": "10556677",
    "address": "3 Fenwick Court, Leeds, LS1 5AB, GB",
    "director_name": "Marcus Feldman",
    "mcc": "5122",
    "business_model": "supplements_subscription",
    "expected_monthly_volume": 90_000.0,
}


def test_the_seeded_reincarnation_case_is_referred_with_the_network_reason(
    session: Session,
) -> None:
    halcyon = session.execute(
        select(Entity).where(Entity.legal_name == "Halcyon Wellness Ltd")
    ).scalars().one()
    decision = session.execute(
        select(Decision)
        .where(Decision.entity_id == halcyon.id, Decision.decision_type == "boarding")
        .order_by(Decision.id.desc())
    ).scalars().first()
    assert decision is not None
    codes = {code["code"] for code in decision.reason_codes}

    assert decision.outcome in {"refer", "decline"}
    assert "RELATED_TO_OFFBOARDED_ENTITY" in codes
    assert decision.required_oversight in {"four_eyes", "suggest"}
    # The applicant is a distinct legal entity, not merged into the terminated one.
    meridian = session.execute(
        select(Entity).where(Entity.legal_name == "Meridian Wellness Ltd")
    ).scalars().one()
    assert halcyon.id != meridian.id
    assert meridian.status == "offboarded"


def test_a_referral_opens_a_case_and_an_agent_run_under_its_arp(session: Session) -> None:
    halcyon = session.execute(
        select(Entity).where(Entity.legal_name == "Halcyon Wellness Ltd")
    ).scalars().one()
    case = session.execute(
        select(Case).where(Case.entity_id == halcyon.id).order_by(Case.id.desc())
    ).scalars().first()
    assert case is not None
    assert case.severity in {"medium", "high", "critical"}
    assert case.status == "open"

    decision = session.execute(
        select(Decision).where(Decision.entity_id == halcyon.id).order_by(Decision.id.desc())
    ).scalars().first()
    assert decision is not None and decision.agent_run_id is not None


def test_a_clean_application_boards_without_a_case(session: Session) -> None:
    result = decisioning.board(session, CLEAN_APPLICATION, actor="test@pulse.example")

    assert result["outcome"] == "approve"
    assert result["reason_codes"] == []
    assert result["case_id"] is None
    assert result["agent_run"] is None
    merchant = session.get(Merchant, result["merchant_id"])
    assert merchant is not None
    assert merchant.lifecycle_state == "boarded"
    assert merchant.boarded_at is not None


def test_a_dissolved_company_is_declined_and_the_reason_is_citable(session: Session) -> None:
    result = decisioning.board(session, DISSOLVED_APPLICATION, actor="test@pulse.example")

    assert result["outcome"] == "decline"
    codes = {code["code"] for code in result["reason_codes"]}
    assert "ENTITY_NOT_ACTIVE" in codes
    assert all(code["sop_ref"] for code in result["reason_codes"])
    assert result["materiality"]["level"] in {"high", "critical"}
    assert result["materiality"]["permitted_autonomy"] == "four_eyes"
    assert result["case_id"] is not None


def test_the_decision_packet_is_explainable_end_to_end(session: Session) -> None:
    result = decisioning.board(
        session,
        {**CLEAN_APPLICATION, "application_id": "APP-TEST-3003"},
        actor="test@pulse.example",
    )

    assert result["policy"]["pack"] == "onboarding"
    assert result["rule_results"], "every rule evaluated is reported, not only those that fired"
    assert result["resolution"]["confidence"] > 0
    assert result["resolution"]["contributions"]
    assert result["kyb"]["registry_found"] is True
    assert "sanctions_true_match" in result["screening"]
    assert result["ubo"]["ubos"]
    assert result["score"]["contributions"]
    assert result["latency_ms"] >= 0


def test_a_uk_applicant_is_assessed_against_the_uk_overlay(session: Session) -> None:
    result = decisioning.board(
        session,
        {
            **CLEAN_APPLICATION,
            "application_id": "APP-TEST-3004",
            "legal_name": "Vertex Digital Exchange Ltd",
            "registration_number": "13445566",
            "mcc": "6051",
            "director_name": None,
        },
        actor="test@pulse.example",
    )
    codes = {code["code"] for code in result["reason_codes"]}
    assert "UK_MSB_NOT_REGISTERED" in codes
    assert result["outcome"] == "decline"


def test_every_boarding_decision_is_recorded_on_the_audit_chain(session: Session) -> None:
    before = audit.verify(session)["events"]
    result = decisioning.board(
        session,
        {**CLEAN_APPLICATION, "application_id": "APP-TEST-3005"},
        actor="test@pulse.example",
    )
    status = audit.verify(session)
    assert status["valid"] is True
    assert status["events"] > before

    timeline = audit.entity_timeline(session, result["entity_id"])
    assert any(row["action"] == "decision.boarding" for row in timeline)
