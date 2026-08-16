"""Governance spine: entitlements, four eyes, brokered action, model risk and the AI gateway.

Each test here is a control, not a feature: the interesting assertion is usually the refusal.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Entity, Merchant
from app.services import (
    action_broker,
    ai_gateway,
    context_assembly,
    entitlements,
    four_eyes,
    model_registry,
)


def _entity_id(session: Session) -> int:
    entity = session.execute(select(Entity)).scalars().first()
    assert entity is not None
    return entity.id


def test_agent_scope_is_the_intersection_never_the_union() -> None:
    analyst = entitlements.Caller(actor="analyst@pulse.example", role="analyst")
    declared = ["facts.registry.status", "credit.file", "facts.application.volume"]

    granted = entitlements.intersect(analyst, declared)
    assert "facts.registry.status" in granted
    assert "credit.file" not in granted, "a pathway cannot lend the caller rights they lack"

    credit_officer = entitlements.Caller(actor="credit@pulse.example", role="credit_officer")
    assert "credit.file" in entitlements.intersect(credit_officer, declared)


def test_classification_and_region_ceilings_are_enforced() -> None:
    caller = entitlements.Caller(
        actor="analyst@pulse.example", role="analyst", max_classification="internal", regions=("EU",)
    )
    assert entitlements.permits_classification(caller, "internal")
    assert not entitlements.permits_classification(caller, "restricted")
    assert entitlements.permits_region(caller, "EU")
    assert not entitlements.permits_region(caller, "US")

    with pytest.raises(entitlements.EntitlementError):
        entitlements.require(caller, "credit.file")


def test_segregation_of_duties_blocks_self_approval_and_non_approving_roles(
    session: Session,
) -> None:
    request = four_eyes.request(
        session,
        subject_type="entity",
        subject_id=_entity_id(session),
        decision_class="monitoring_action",
        action="restrict",
        proposer="analyst@pulse.example",
        proposer_role="analyst",
    )

    with pytest.raises(entitlements.EntitlementError):
        four_eyes.decide(
            session,
            request.id,
            approver="analyst@pulse.example",
            approver_role="second_line",
            approve=True,
            rationale="approving my own proposal",
        )
    with pytest.raises(four_eyes.ApprovalError):
        four_eyes.decide(
            session,
            request.id,
            approver="other.analyst@pulse.example",
            approver_role="analyst",
            approve=True,
            rationale="first line cannot approve",
        )
    with pytest.raises(four_eyes.ApprovalError):
        four_eyes.decide(
            session,
            request.id,
            approver="supervisor@pulse.example",
            approver_role="second_line",
            approve=True,
            rationale="   ",
        )

    decided = four_eyes.decide(
        session,
        request.id,
        approver="supervisor@pulse.example",
        approver_role="second_line",
        approve=True,
        rationale="ownership unresolved; restriction proportionate",
    )
    assert decided.state == "approved"

    with pytest.raises(four_eyes.ApprovalError):
        four_eyes.decide(
            session,
            request.id,
            approver="supervisor@pulse.example",
            approver_role="second_line",
            approve=False,
            rationale="changed my mind",
        )


def test_agent_cannot_take_a_consequential_action_without_an_approval(session: Session) -> None:
    entity_id = _entity_id(session)
    with pytest.raises(action_broker.BrokerError):
        action_broker.execute(
            session,
            action_type="terminate",
            entity_id=entity_id,
            actor="arp:monitoring-triage",
            actor_type="agent",
            authority_basis="rule:MON-004",
        )
    with pytest.raises(action_broker.BrokerError):
        action_broker.execute(
            session,
            action_type="teleport_funds",
            entity_id=entity_id,
            actor="analyst@pulse.example",
            authority_basis="improvisation",
        )


def test_a_reversible_action_can_be_rolled_back_and_state_restored(session: Session) -> None:
    merchant = session.execute(
        select(Merchant).where(Merchant.lifecycle_state.in_(["active", "boarded"]))
    ).scalars().first()
    assert merchant is not None
    before = merchant.lifecycle_state

    request = four_eyes.request(
        session,
        subject_type="entity",
        subject_id=merchant.entity_id,
        decision_class="monitoring_action",
        action="hold_funds",
        proposer="analyst@pulse.example",
    )
    four_eyes.decide(
        session,
        request.id,
        approver="supervisor@pulse.example",
        approver_role="second_line",
        approve=True,
        rationale="suspected layering pending review",
    )
    executed = action_broker.execute(
        session,
        action_type="hold_funds",
        entity_id=merchant.entity_id,
        actor="analyst@pulse.example",
        authority_basis="rule:MON-002",
        approval_request_id=request.id,
    )
    assert executed.rollback_token
    assert merchant.lifecycle_state == "restricted"

    rolled_back = action_broker.rollback(
        session,
        rollback_token=executed.rollback_token,
        actor="supervisor@pulse.example",
        reason="alert explained by a seasonal campaign",
    )
    assert rolled_back.state == "rolled_back"
    assert merchant.lifecycle_state == before
    assert action_broker.serialise(rolled_back)["prior_state"] == before


def test_only_a_validated_artefact_may_run(session: Session) -> None:
    inventory = model_registry.inventory(session)
    assert inventory
    artefact = inventory[0]
    purpose = artefact["approved_use"][0]

    model_registry.set_state(
        session,
        artefact["key"],
        artefact["version"],
        state="retired",
        actor="model.risk@pulse.example",
        reason="withdrawn pending revalidation",
    )
    with pytest.raises(model_registry.RegistryError):
        model_registry.require_runnable(session, artefact["key"], purpose=purpose)

    model_registry.set_state(
        session,
        artefact["key"],
        artefact["version"],
        state="validated",
        actor="model.risk@pulse.example",
        reason="revalidation complete",
    )
    assert model_registry.require_runnable(session, artefact["key"], purpose=purpose)

    with pytest.raises(model_registry.RegistryError):
        model_registry.require_runnable(
            session, artefact["key"], purpose="something_it_was_never_approved_for"
        )


def test_gateway_refuses_data_the_caller_may_not_send_and_logs_what_it_ran(
    session: Session,
) -> None:
    caller = entitlements.Caller(
        actor="analyst@pulse.example", role="analyst", max_classification="internal"
    )
    with pytest.raises(ai_gateway.GatewayError):
        ai_gateway.invoke(
            session,
            artefact_key="grounded-answer-composer",
            purpose="policy_qa",
            caller=caller,
            context={"question": "what does the policy say?"},
            classification="restricted",
        )

    invocation = ai_gateway.invoke(
        session,
        artefact_key="grounded-answer-composer",
        purpose="policy_qa",
        caller=caller,
        context={"question": "what does the policy say?"},
        passages=[{"text": "Ownership below 25% requires no UBO declaration.", "ref": "POL-KYB-001"}],
        use_case="grounded_policy_qa",
    )
    assert invocation.citations, "an answer without citations is not an answer (C1)"
    assert invocation.cost >= 0.0
    assert ai_gateway.budget_state(session)["by_use_case"]


def test_assembled_context_carries_provenance_and_names_what_it_withheld(
    session: Session,
) -> None:
    caller = entitlements.Caller(actor="analyst@pulse.example", role="analyst")
    manifest = context_assembly.assemble(
        session,
        caller=caller,
        declared_scopes=["facts.registry.status", "credit.file", "merchant.*"],
        entity_id=_entity_id(session),
    )
    assert "credit.file" in manifest.denied_scopes
    assert manifest.granted_scopes
    assert manifest.freshness
