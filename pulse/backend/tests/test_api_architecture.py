"""API contract tests for the surfaces the revised technical architecture adds.

The architecture endpoints are load-bearing rather than cosmetic: the component register is how the
platform states, to an examiner or a reviewer, which capabilities are actually implemented and which
are reference or planned. A component that claims more than the code does is the failure mode these
tests exist to catch.
"""

from __future__ import annotations

import importlib

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Merchant

STATES = {"implemented", "reference", "planned"}


def test_component_register_declares_a_state_and_a_horizon_for_every_component(
    client: TestClient,
) -> None:
    components = client.get("/api/platform/components").json()
    assert len(components) >= 40
    for component in components:
        assert component["id"].startswith("PLS-")
        assert component["state"] in STATES
        assert component["horizon"].startswith("H")
        assert component["layer"] in {
            "data",
            "know",
            "detect",
            "act",
            "engagement",
            "governance",
            "ai_access",
        }

    architecture = client.get("/api/platform/architecture").json()
    assert architecture["principles"]
    assert architecture["commitments"]
    assert architecture["nfr_targets"]
    assert architecture["summary"]["by_state"].keys() <= STATES
    assert sum(architecture["summary"]["by_state"].values()) == len(components)


def test_implemented_components_name_modules_that_exist(client: TestClient) -> None:
    """An 'implemented' claim has to point at code, or the register is marketing."""
    for component in client.get("/api/platform/components").json():
        if component["state"] != "implemented":
            continue
        assert component["modules"], f"{component['id']} claims implemented with no module"
        for module in component["modules"]:
            if module.startswith("app."):
                importlib.import_module(module)


def test_traceability_links_use_cases_and_roadmap_to_real_components(client: TestClient) -> None:
    codes = {component["id"] for component in client.get("/api/platform/components").json()}

    traceability = client.get("/api/platform/traceability").json()
    assert traceability["use_cases"]
    for row in traceability["use_cases"]:
        assert row["components"]
        assert set(row["components"]) <= codes

    for phase in client.get("/api/platform/roadmap").json():
        assert {component["id"] for component in phase["components"]} <= codes
        assert phase["delivered"] <= phase["total"]

    adrs = client.get("/api/platform/adrs").json()
    assert adrs
    assert all(adr["decision"] and adr["status"] for adr in adrs)


def test_event_topics_and_the_event_log_are_queryable(client: TestClient) -> None:
    topics = client.get("/api/platform/events/topics").json()
    assert topics
    names = {topic["topic"] for topic in topics}
    assert "risk.decision.recorded.v1" in names

    log = client.get("/api/platform/events", params={"limit": 25}).json()
    assert log
    assert all(entry["topic"] in names for entry in log)
    assert all(entry["event_id"] and entry["recorded_at"] for entry in log)

    replay = client.post(
        "/api/platform/events/replay",
        json={"topics": ["risk.decision.recorded.v1"], "dry_run": True},
    ).json()
    assert replay["matched"] >= 1
    assert replay["redelivered"] == 0


def test_source_and_provenance_surfaces_report_freshness(client: TestClient) -> None:
    sources = client.get("/api/platform/sources").json()
    assert sources
    assert all(source["criticality_tier"] in {0, 1, 2, 3} for source in sources)

    entity_id = client.get("/api/merchants").json()[0]["entity_id"]
    provenance = client.get(f"/api/merchants/{entity_id}/provenance").json()
    assert provenance["facts"]
    assert all(fact["freshness"] for fact in provenance["facts"].values())
    assert provenance["staleness"]["by_freshness"]


def test_requirement_lifecycle_over_the_api(client: TestClient) -> None:
    entity_id = client.get("/api/merchants").json()[0]["entity_id"]

    created = client.post(
        "/api/requirements",
        json={
            "entity_id": entity_id,
            "requirement_type": "business_model_explanation",
            "rationale": "stated model inconsistent with observed MCC",
        },
    )
    assert created.status_code == 200, created.text
    requirement = created.json()
    assert requirement["state"] == "outstanding"

    rejected = client.post(
        "/api/requirements",
        json={"entity_id": entity_id, "requirement_type": "not_in_the_catalogue"},
    )
    assert rejected.status_code == 409

    listed = client.get("/api/requirements", params={"entity_id": entity_id}).json()
    assert "business_model_explanation" in listed["catalogue"]
    assert any(row["id"] == requirement["id"] for row in listed["outstanding"])
    assert listed["ageing"]["outstanding"] >= 1


def test_four_eyes_and_broker_refusals_surface_as_conflicts_not_500s(client: TestClient) -> None:
    entity_id = client.get("/api/merchants").json()[0]["entity_id"]

    request = client.post(
        "/api/governance/approvals",
        json={
            "subject_type": "entity",
            "subject_id": entity_id,
            "decision_class": "monitoring_action",
            "action": "restrict",
            "payload": {"reason": "ownership unresolved"},
        },
    ).json()

    self_approval = client.post(
        f"/api/governance/approvals/{request['id']}/decide",
        json={
            "approve": True,
            "rationale": "approving my own request",
            "approver": "analyst@pulse.example",
            "approver_role": "second_line",
        },
    )
    assert self_approval.status_code == 403

    unapproved = client.post(
        "/api/governance/actions",
        json={
            "action_type": "terminate",
            "entity_id": entity_id,
            "authority_basis": "rule:MON-004",
            "actor": "arp:monitoring-triage",
            "actor_type": "agent",
        },
    )
    assert unapproved.status_code == 409

    approved = client.post(
        f"/api/governance/approvals/{request['id']}/decide",
        json={
            "approve": True,
            "rationale": "ownership unresolved and volume rising; restriction proportionate",
        },
    )
    assert approved.status_code == 200
    assert approved.json()["state"] == "approved"


def test_decision_explanation_replay_and_attestation(client: TestClient) -> None:
    entity_id = client.get("/api/merchants").json()[0]["entity_id"]
    decisions = client.get(f"/api/merchants/{entity_id}").json()["decisions"]
    assert decisions
    decision_id = decisions[0]["id"]

    explanation = client.get(f"/api/decisions/{decision_id}/explain").json()
    assert explanation["policy"]["version"]
    assert explanation["fact_provenance"]

    replay = client.get(f"/api/decisions/{decision_id}/replay").json()
    assert replay["replayable"] is True

    attestation = client.get("/api/audit/replay-attestation").json()
    assert attestation["decisions_examined"] >= 1
    assert attestation["unexplained_divergences"] == []


def test_transaction_ingest_normalises_and_reports_exposure(
    client: TestClient, session: Session
) -> None:
    merchant = session.execute(
        select(Merchant).where(Merchant.platform_mid.is_not(None))
    ).scalars().first()
    assert merchant is not None
    mid = merchant.platform_mid

    response = client.post(
        "/api/transactions/ingest",
        json={
            "source_platform": "acquiring",
            "events": [
                {
                    "auth_id": "api-test-auth-1",
                    "mid": mid,
                    "amount": 250.0,
                    "currency": "EUR",
                    "auth_time": "2026-01-05T10:00:00Z",
                    "mcc": merchant.mcc,
                    "issuer_country": "IE",
                    "entry_mode": "ecommerce",
                },
                {
                    "auth_id": "api-test-auth-1",
                    "mid": mid,
                    "amount": 250.0,
                    "currency": "EUR",
                    "auth_time": "2026-01-05T10:00:00Z",
                },
            ],
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["accepted"] == 1
    assert result["duplicates"] == 1

    health = client.get("/api/transactions/health").json()
    assert health["events"] >= 1

    exposure = client.get(f"/api/merchants/{merchant.entity_id}/exposure").json()
    assert exposure["window_days"] >= 1
    assert client.get("/api/merchants/999999/exposure").status_code == 404


def test_ai_gateway_surfaces_report_spend_and_assemble_context(client: TestClient) -> None:
    budget = client.get("/api/ai/budget").json()
    assert "period_budget" in budget
    assert budget["unit_cost_per_1k"]

    invocations = client.get("/api/ai/invocations").json()
    assert isinstance(invocations, list)

    entity_id = client.get("/api/merchants").json()[0]["entity_id"]
    context = client.post(
        "/api/ai/context",
        json={
            "entity_id": entity_id,
            "scopes": ["facts.registry.status", "credit.file"],
            "role": "analyst",
        },
    ).json()
    assert "credit.file" in context["denied_scopes"]
    assert context["granted_scopes"]


def test_governance_registries_and_drift_are_exposed(client: TestClient) -> None:
    entitlements = client.get("/api/governance/entitlements").json()
    assert entitlements["role_scopes"]["analyst"]
    assert "credit.*" not in entitlements["role_scopes"]["analyst"]

    registry = client.get("/api/governance/model-registry").json()
    assert registry
    assert all(artefact["state"] for artefact in registry)

    drift = client.get("/api/governance/drift").json()
    assert drift["features"]["features"]
    assert all(
        entry["band"] in {"stable", "moderate", "material"}
        for entry in drift["features"]["features"]
    )
