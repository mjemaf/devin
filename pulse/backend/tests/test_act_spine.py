"""ACT: requirements, outcome feedback, drift demotion, explanation and decision replay.

The theme is accountability after the fact — a decision that cannot be explained or replayed, or an
autonomy tier that cannot be taken away, is not something an examiner will accept.
"""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ARP, Decision, EvidenceDocument, Merchant, utcnow
from app.services import agents, evaluation, explainability, outcomes, requirements


def _merchant(session: Session) -> Merchant:
    merchant = session.execute(select(Merchant)).scalars().first()
    assert merchant is not None
    return merchant


def test_a_requirement_only_closes_against_evidence_that_satisfies_it(session: Session) -> None:
    merchant = _merchant(session)
    requirement = requirements.raise_requirement(
        session,
        entity_id=merchant.entity_id,
        requirement_type="bank_statement",
        requested_by="analyst@pulse.example",
        rationale="declared volume unverified",
    )
    assert requirement.consequence == "credit_limit_frozen"
    assert requirement.accepted_evidence == ["financial_statement"]

    wrong = EvidenceDocument(
        entity_id=merchant.entity_id,
        doc_type="declaration",
        title="Self-declared turnover",
        text="We turn over about 2m a year.",
    )
    session.add(wrong)
    session.flush()
    with pytest.raises(requirements.RequirementError):
        requirements.satisfy(
            session, requirement.id, evidence_id=wrong.id, actor="analyst@pulse.example"
        )

    right = EvidenceDocument(
        entity_id=merchant.entity_id,
        doc_type="financial_statement",
        title="Bank statement Q3",
        text="Closing balance 412,880.",
    )
    session.add(right)
    session.flush()
    satisfied = requirements.satisfy(
        session, requirement.id, evidence_id=right.id, actor="analyst@pulse.example"
    )
    assert satisfied.state == "satisfied"
    assert satisfied.evidence_id == right.id

    with pytest.raises(requirements.RequirementError):
        requirements.satisfy(
            session, requirement.id, evidence_id=right.id, actor="analyst@pulse.example"
        )
    with pytest.raises(requirements.RequirementError):
        requirements.raise_requirement(
            session,
            entity_id=merchant.entity_id,
            requirement_type="a_document_nobody_defined",
            requested_by="analyst@pulse.example",
        )


def test_an_overdue_requirement_applies_its_declared_consequence(session: Session) -> None:
    merchant = _merchant(session)
    requirement = requirements.raise_requirement(
        session,
        entity_id=merchant.entity_id,
        requirement_type="source_of_funds",
        requested_by="analyst@pulse.example",
    )
    requirement.due_at = utcnow() - dt.timedelta(days=3)
    session.flush()

    escalated = requirements.escalate_overdue(session)
    assert any(item["requirement_id"] == requirement.id for item in escalated)
    session.refresh(requirement)
    assert requirement.state == "overdue"

    again = requirements.escalate_overdue(session)
    assert all(item["requirement_id"] != requirement.id for item in again), (
        "escalation must not fire twice for the same requirement"
    )


def test_outcome_labels_feed_alert_quality(session: Session) -> None:
    merchant = _merchant(session)
    outcomes.label(
        session,
        subject_type="alert",
        subject_id=999_001,
        entity_id=merchant.entity_id,
        label="false_positive",
        arp_key="monitoring-triage",
        predicted="escalate",
        observed="no_action",
        labelled_by="analyst@pulse.example",
    )
    with pytest.raises(ValueError):
        outcomes.label(
            session, subject_type="alert", subject_id=999_002, label="probably_fine"
        )

    distribution = outcomes.label_distribution(session, arp_key="monitoring-triage")
    assert distribution.get("false_positive", 0) >= 1
    assert outcomes.precision(session, arp_key="monitoring-triage") is not None


def test_disagreement_demotes_an_autonomy_tier_without_a_promotion_gate(session: Session) -> None:
    arp = session.execute(select(ARP)).scalars().first()
    assert arp is not None
    arp.autonomy_tier = "four_eyes"
    session.flush()
    starting_rank = agents.TIER_RANK[arp.autonomy_tier]

    for index in range(40):
        outcomes.label(
            session,
            subject_type="agent_run",
            subject_id=990_000 + index,
            label="false_positive",
            arp_key=arp.key,
            predicted="escalate",
            observed="no_action",
            labelled_by="analyst@pulse.example",
        )

    report = evaluation.drift_check(session, arp.key, actor="system")
    assert report["sufficient_evidence"]
    assert report["breached"], "sustained disagreement must breach the agreement floor"
    assert report["demoted_to"] is not None
    session.refresh(arp)
    assert agents.TIER_RANK[arp.autonomy_tier] < starting_rank
    assert arp.tier_history[-1]["drift_demotion"] is True


def test_the_seeded_book_carries_a_recent_cohort_that_makes_drift_observable(
    session: Session,
) -> None:
    """The fixture, not just the algorithm: a seed with no recent boardings cannot drift."""
    drift = evaluation.feature_drift(session)
    chargeback = next(
        item for item in drift["features"] if item["feature"] == "merchant.chargeback_rate"
    )
    assert chargeback["recent_n"] >= 5
    assert chargeback["recent_mean"] > chargeback["baseline_mean"]
    assert "merchant.chargeback_rate" in drift["material_shifts"]

    # Seeded disagreement is sized to breach the floor, so a sweep has something to demote.
    triage = evaluation.drift_check(session, "monitoring-triage")
    assert triage["sufficient_evidence"] and triage["breached"]
    assert triage["demoted_to"] == "shadow"


def test_every_recorded_decision_explains_and_replays_to_the_same_outcome(
    session: Session,
) -> None:
    adverse = session.execute(
        select(Decision).where(Decision.outcome == "decline")
    ).scalars().first()
    assert adverse is not None

    explanation = explainability.explain(session, adverse.id)
    assert explanation["reason_codes"], "an adverse decision must state why"
    assert explanation["rules_fired"]
    assert explanation["policy"]["version"]
    assert explanation["accountable_party"]
    assert explanation["fact_provenance"]

    replayed = explainability.replay(session, adverse.id)
    assert replayed["replayable"]
    assert replayed["outcome_matches"], (
        "same facts and same policy version must reproduce the recorded outcome (C3)"
    )

    fleet = explainability.replay_all(session)
    assert fleet["decisions_examined"] >= 1
    assert fleet["unexplained_divergences"] == []


def test_an_adverse_notice_is_refused_for_an_approval_and_withholds_internals(
    session: Session,
) -> None:
    approved = session.execute(
        select(Decision).where(Decision.outcome == "approve")
    ).scalars().first()
    assert approved is not None
    with pytest.raises(explainability.ExplainError):
        explainability.adverse_action(
            session, approved.id, issued_by="analyst@pulse.example", record=False
        )

    adverse = session.execute(
        select(Decision).where(Decision.outcome == "decline")
    ).scalars().first()
    assert adverse is not None
    notice = explainability.adverse_action(
        session, adverse.id, issued_by="analyst@pulse.example", record=False
    )
    assert notice["reasons"]
    assert notice["internal_detail_withheld"] is True
    serialised = repr(notice["reasons"]).lower()
    for leak in ("model", "threshold", "vendor", "risk score"):
        assert leak not in serialised, f"the customer notice must not disclose {leak} internals"
