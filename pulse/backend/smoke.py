"""Ad-hoc API smoke walk used during development: exercises every console surface."""

from __future__ import annotations

import sys
import traceback
from typing import Any

from fastapi.testclient import TestClient

from app.main import app

FAILURES: list[str] = []


def show(label: str, response: Any, width: int = 200, expect: int = 200) -> Any:
    try:
        body = response.json()
    except Exception:
        body = response.text
    ok = response.status_code == expect
    if not ok:
        FAILURES.append(f"{label} -> {response.status_code} {str(body)[:400]}")
    print(f"{'ok ' if ok else 'ERR'} {label} [{response.status_code}] {str(body)[:width]}")
    return body


def main() -> int:
    with TestClient(app) as client:
        for path in [
            "/api/health",
            "/api/platform/overview",
            "/api/platform/policies",
            "/api/platform/materiality",
            "/api/merchants",
            "/api/cases",
            "/api/cases/queue",
            "/api/monitoring/monitors",
            "/api/monitoring/alerts",
            "/api/agents/arps",
            "/api/agents/runs",
            "/api/screening/hits",
            "/api/knowledge/documents",
            "/api/knowledge/queries",
            "/api/audit/verify",
            "/api/audit/events",
        ]:
            show(path, client.get(path))

        merchants = client.get("/api/merchants").json()
        entity_id = merchants[0]["entity_id"]
        show(f"merchant360 {entity_id}", client.get(f"/api/merchants/{entity_id}"), 300)
        show(f"graph {entity_id}", client.get(f"/api/merchants/{entity_id}/graph"), 300)
        show(f"screen {entity_id}", client.post(f"/api/merchants/{entity_id}/screen", json={}), 300)
        show(f"timeline {entity_id}", client.get(f"/api/audit/timeline/{entity_id}"), 200)
        show(f"export {entity_id}", client.get(f"/api/audit/export/{entity_id}"), 200)

        show(
            "ask grounded",
            client.post(
                "/api/knowledge/ask",
                json={
                    "question": "What must we do when a beneficial owner cannot be established?",
                    "asked_by": "analyst@pulse.example",
                },
            ),
            600,
        )
        show(
            "ask refusal",
            client.post(
                "/api/knowledge/ask",
                json={"question": "Who won the 1998 World Cup?", "asked_by": "a@pulse.example"},
            ),
            300,
        )
        show(
            "policy evaluate",
            client.post(
                "/api/platform/policies/evaluate",
                json={
                    "pack": "onboarding",
                    "facts": {
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
                        "merchant.expected_monthly_volume": 100000,
                        "credit.thin_file": False,
                        "credit.credit_score": 70,
                    },
                },
            ),
            300,
        )

        show("sweep", client.post("/api/monitoring/sweep", json={}), 300)
        show(
            "list update",
            client.post("/api/monitoring/events/list-update", json={"list_name": "OFAC SDN"}),
        )
        show(
            "txn signal",
            client.post(
                "/api/monitoring/events/transaction-signal",
                json={
                    "merchant_id": merchants[0]["merchant_id"],
                    "monthly_volume": 900000,
                    "chargeback_rate": 0.02,
                    "business_model": "high-risk supplements subscription",
                },
            ),
            300,
        )

        cases = client.get("/api/cases").json()
        if cases:
            case_id = cases[0]["id"]
            show(f"case {case_id}", client.get(f"/api/cases/{case_id}"), 200)
            show(
                "assign",
                client.post(
                    f"/api/cases/{case_id}/assign",
                    json={"assignee": "analyst@pulse.example", "actor": "lead@pulse.example"},
                ),
            )
            show(
                "note",
                client.post(
                    f"/api/cases/{case_id}/notes",
                    json={"note": "Requested registry extract", "actor": "analyst@pulse.example"},
                ),
            )

        runs = client.get("/api/agents/runs").json()
        if runs:
            run_id = runs[0]["id"]
            show(
                "agent review",
                client.post(
                    f"/api/agents/runs/{run_id}/review",
                    json={
                        "reviewer": "analyst@pulse.example",
                        "outcome": "decline",
                        "note": "Registry dissolved; decline confirmed",
                    },
                ),
                300,
            )
            show(
                "agent approve (same person, must fail)",
                client.post(
                    f"/api/agents/runs/{run_id}/approve",
                    json={"approver": "analyst@pulse.example"},
                ),
                expect=409,
            )
            show(
                "agent approve (second line)",
                client.post(
                    f"/api/agents/runs/{run_id}/approve",
                    json={"approver": "second.line@pulse.example"},
                ),
                300,
            )

        hits = client.get("/api/screening/hits").json()
        if hits:
            show(
                "hit review",
                client.post(
                    f"/api/screening/hits/{hits[0]['hit_id']}/review",
                    json={
                        "reviewer": "analyst@pulse.example",
                        "disposition": "false_positive",
                        "rationale": "Different date of birth and nationality on the list entry",
                    },
                ),
                300,
            )

        show("arp evaluation", client.get("/api/agents/arps/boarding-triage/evaluation"), 300)
        show("audit verify", client.get("/api/audit/verify"))

    if FAILURES:
        print("\nFAILURES:")
        for failure in FAILURES:
            print(" -", failure)
        return 1
    print("\nall endpoints ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
