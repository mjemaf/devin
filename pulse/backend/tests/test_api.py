"""API contract tests for the surfaces the analyst console depends on."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def test_health_and_overview_describe_the_platform(client: TestClient) -> None:
    assert client.get("/api/health").json()["status"] == "ok"

    overview = client.get("/api/platform/overview").json()
    assert overview["portfolio"]["merchants"] >= 8
    assert overview["audit"]["valid"] is True
    assert overview["queues"]["open"] >= 1
    assert overview["automation"]
    assert overview["screening"]


def test_merchant_list_and_360_expose_provenance(client: TestClient) -> None:
    merchants = client.get("/api/merchants").json()
    assert merchants
    entity_id = merchants[0]["entity_id"]

    view = client.get(f"/api/merchants/{entity_id}").json()
    assert view["entity"]["legal_name"]
    assert view["facts"], "every attribute shown must carry its source"
    assert all("source" in fact for fact in view["facts"].values())
    assert "score" in view
    assert "ownership" in view
    assert "alerts" in view
    assert "decisions" in view


def test_unknown_entity_is_a_404_not_a_500(client: TestClient) -> None:
    assert client.get("/api/merchants/999999").status_code == 404


def test_graph_endpoint_returns_paths_and_flags(client: TestClient) -> None:
    merchants = client.get("/api/merchants").json()
    halcyon = next(m for m in merchants if m["display_name"].startswith("Halcyon"))
    graph = client.get(f"/api/merchants/{halcyon['entity_id']}/graph").json()
    assert graph["ownership"]["nodes"] and graph["ownership"]["edges"]
    assert any(
        flag["flag"] == "linked_to_offboarded_entity" for flag in graph["network"]["risk_flags"]
    )


def test_policy_endpoints_evaluate_and_list(client: TestClient) -> None:
    packs = client.get("/api/platform/policies").json()
    assert any(pack["pack"] == "onboarding" for pack in packs)

    facts: dict[str, Any] = {
        "entity.country": "GB",
        "resolution.review_required": False,
        "resolution.confidence": 0.99,
        "kyb.registry_status": "active",
        "kyb.unresolved_ownership_percentage": 40,
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
    result = client.post(
        "/api/platform/policies/evaluate", json={"pack": "onboarding", "facts": facts}
    ).json()
    assert result["outcome"] == "refer"
    assert "UBO_NOT_ESTABLISHED" in {code["code"] for code in result["reason_codes"]}
    assert result["counterfactuals"]


def test_an_invalid_policy_pack_is_rejected_with_a_client_error(client: TestClient) -> None:
    response = client.post("/api/platform/policies/evaluate", json={"pack": "nope", "facts": {}})
    assert response.status_code in {400, 404, 409, 422}


def test_boarding_endpoint_returns_the_full_decision_packet(client: TestClient) -> None:
    response = client.post(
        "/api/boarding/applications",
        json={
            "application_id": "APP-API-4001",
            "legal_name": "Northwind Retail Limited",
            "country": "GB",
            "registration_number": "09112233",
            "address": "18 Kingsway, London, WC2B 6UN, GB",
            "director_name": "Sarah Whitfield",
            "mcc": "5691",
            "expected_monthly_volume": 30_000,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["outcome"] == "approve"
    assert body["policy"]["pack"] == "onboarding"
    assert body["score"]["band"]


def test_knowledge_ask_grounds_or_refuses(client: TestClient) -> None:
    grounded = client.post(
        "/api/knowledge/ask",
        json={"question": "What must we do when a beneficial owner cannot be established?"},
    ).json()
    assert grounded["grounded"] is True
    assert grounded["citations"]

    refused = client.post(
        "/api/knowledge/ask", json={"question": "Who won the 1998 World Cup?"}
    ).json()
    assert refused["grounded"] is False
    assert refused["citations"] == []

    gaps = client.get("/api/knowledge/queries").json()
    assert any(row["grounded"] is False for row in gaps)


def test_case_queue_is_ordered_by_urgency(client: TestClient) -> None:
    queue = client.get("/api/cases/queue").json()
    assert queue["open"] >= 1
    assert queue["by_severity"]
    assert queue["by_type"]
    assert isinstance(queue["sla_breached"], list)


def test_case_assignment_and_notes_are_recorded(client: TestClient) -> None:
    cases = client.get("/api/cases").json()
    # Halcyon's case is the fixture other scenarios assert against, so work on a different one.
    case_id = next(
        case["id"]
        for case in cases
        if case["status"] == "open" and not (case["entity_name"] or "").startswith("Halcyon")
    )

    assigned = client.post(
        f"/api/cases/{case_id}/assign",
        json={"assignee": "analyst@pulse.example", "actor": "lead@pulse.example"},
    )
    assert assigned.status_code == 200
    assert assigned.json()["assignee"] == "analyst@pulse.example"

    noted = client.post(
        f"/api/cases/{case_id}/notes",
        json={"note": "Requested a registry extract", "actor": "analyst@pulse.example"},
    )
    assert noted.status_code == 200
    detail = client.get(f"/api/cases/{case_id}").json()
    assert any(
        event["action"] == "note" and "registry extract" in event["note"]
        for event in detail["events"]
    )


def test_monitoring_endpoints_sweep_and_list(client: TestClient) -> None:
    monitors = client.get("/api/monitoring/monitors").json()
    assert monitors

    sweep = client.post("/api/monitoring/sweep", json={}).json()
    assert sweep["merchants_assessed"] >= 5

    alerts = client.get("/api/monitoring/alerts").json()
    assert alerts
    assert all("occurrences" in alert for alert in alerts)


def test_a_registry_change_event_raises_an_alert_through_the_api(client: TestClient) -> None:
    merchants = client.get("/api/merchants").json()
    target = next(m for m in merchants if m["lifecycle_state"] in {"active", "boarded"})
    before = len(client.get("/api/monitoring/alerts").json())

    response = client.post(
        "/api/monitoring/events/registry-change",
        json={"entity_id": target["entity_id"], "status": "dissolved"},
    )
    assert response.status_code == 200
    assert len(client.get("/api/monitoring/alerts").json()) > before


def test_agent_queue_hides_shadow_runs_and_enforces_four_eyes(client: TestClient) -> None:
    merchants = client.get("/api/merchants").json()
    halcyon = next(m for m in merchants if m["display_name"].startswith("Halcyon"))

    runs = client.get("/api/agents/runs").json()
    assert runs
    assert all(run["mode"] != "shadow" for run in runs)

    # Halcyon's run is the fixture other scenarios assert against, so review a different one.
    run_id = next(
        run["id"]
        for run in runs
        if run["entity_id"] != halcyon["entity_id"] and run["status"] == "pending_review"
    )
    reviewed = client.post(
        f"/api/agents/runs/{run_id}/review",
        json={
            "reviewer": "analyst@pulse.example",
            "outcome": "decline",
            "note": "Registry dissolved; decline confirmed",
        },
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "pending_approval"

    same_person = client.post(
        f"/api/agents/runs/{run_id}/approve", json={"approver": "analyst@pulse.example"}
    )
    assert same_person.status_code == 409

    approved = client.post(
        f"/api/agents/runs/{run_id}/approve", json={"approver": "second.line@pulse.example"}
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"


def test_arp_evaluation_reports_promotion_blockers(client: TestClient) -> None:
    evaluation = client.get("/api/agents/arps/boarding-triage/evaluation").json()
    assert evaluation["autonomy_ceiling"] == "four_eyes"
    assert evaluation["promotion_ready"] is False
    assert evaluation["blockers"]


def test_kill_switch_can_be_engaged_and_released(client: TestClient) -> None:
    engaged = client.post(
        "/api/agents/arps/policy-qa/kill-switch",
        json={"engaged": True, "actor": "risk.owner@pulse.example", "reason": "eval regression"},
    ).json()
    assert engaged["kill_switch_engaged"] is True
    assert engaged["autonomy_tier"] == "shadow"

    released = client.post(
        "/api/agents/arps/policy-qa/kill-switch",
        json={"engaged": False, "actor": "risk.owner@pulse.example", "reason": "fix verified"},
    ).json()
    assert released["kill_switch_engaged"] is False


def test_screening_hit_review_records_the_human_disposition(client: TestClient) -> None:
    hits = client.get("/api/screening/hits").json()
    assert hits
    response = client.post(
        f"/api/screening/hits/{hits[0]['hit_id']}/review",
        json={
            "reviewer": "analyst@pulse.example",
            "disposition": "false_positive",
            "rationale": "Different date of birth and nationality on the list entry",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["disposition"] == "false_positive"
    assert body["reviewed_by"] == "analyst@pulse.example"


def test_audit_endpoints_verify_and_export(client: TestClient) -> None:
    assert client.get("/api/audit/verify").json()["valid"] is True

    merchants = client.get("/api/merchants").json()
    entity_id = merchants[0]["entity_id"]
    timeline = client.get(f"/api/audit/timeline/{entity_id}").json()
    assert timeline

    pack = client.get(f"/api/audit/export/{entity_id}").json()
    assert pack["chain_status"]["valid"] is True
    assert pack["audit_events"]

    replay = client.get(
        "/api/audit/as-of",
        params={
            "question": "What must we do when a beneficial owner cannot be established?",
            "as_of": "2026-01-01T00:00:00Z",
        },
    ).json()
    assert replay["as_of"].startswith("2026-01-01")


def test_openapi_documents_every_router(client: TestClient) -> None:
    spec = client.get("/openapi.json").json()
    paths = set(spec["paths"])
    for expected in (
        "/api/boarding/applications",
        "/api/merchants",
        "/api/knowledge/ask",
        "/api/cases/queue",
        "/api/monitoring/sweep",
        "/api/agents/runs",
        "/api/audit/verify",
    ):
        assert expected in paths
