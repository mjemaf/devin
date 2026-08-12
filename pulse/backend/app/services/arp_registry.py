"""The registered Automated Resolution Pathways shipped with the platform.

Each pathway declares its SOPs, the exact data it may touch, what it may recommend, the criteria
for promotion, and its permanent ceiling. Nothing here is decorative: :mod:`app.services.agents`
enforces the data contract, the permitted recommendations and the ceiling at run time.

The tier recorded at registration is the tier the accountable risk owner has signed off; anything
above it must be earned through :func:`app.services.agents.evaluate_arp`. No pathway registers
above ``suggest``, and no ceiling exceeds ``four_eyes`` for a consequential action.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.services import agents

ARPS: list[dict[str, Any]] = [
    {
        "key": "boarding-triage",
        "task": "Triage a merchant application and recommend approve / conditions / refer / decline",
        "sop_refs": ["POL-KYB-002 §2-§5", "POL-SANC-001 §3-§4", "POL-ACC-001 §2-§3"],
        "data_contract": [
            "entity.*",
            "facts.registry.*",
            "screening.hits",
            "graph.ownership",
            "graph.network",
            "scores.merchant_risk",
            "credit.summary",
        ],
        "permitted_recommendations": [
            "approve",
            "approve_with_conditions",
            "escalate",
            "decline",
        ],
        "success_criteria": {
            "min_reviewed_cases": 500,
            "min_agreement": 0.95,
            "max_severity_1_misses": 0,
            "p95_latency_ms": 4000,
        },
        # Declines are adverse actions: four eyes is a permanent ceiling, not a starting point.
        "autonomy_ceiling": "four_eyes",
        "autonomy_tier": "suggest",
    },
    {
        "key": "screening-disposition",
        "task": "Propose a disposition for a potential watchlist match with the identifiers compared",
        "sop_refs": ["POL-SANC-001 §5", "POL-SANC-001 §6"],
        "data_contract": [
            "entity.*",
            "screening.hits",
            "facts.registry.*",
            "graph.ownership",
        ],
        "permitted_recommendations": ["false_positive", "potential_match", "escalate"],
        "success_criteria": {
            "min_reviewed_cases": 500,
            "min_agreement": 0.97,
            "max_severity_1_misses": 0,
            "p95_latency_ms": 2000,
        },
        # Discounting a sanctions match may never be automated (POL-SANC-001 §8).
        "autonomy_ceiling": "four_eyes",
    },
    {
        "key": "kyb-evidence-collection",
        "task": "Collect and reconcile registry evidence, and list the outstanding evidence gaps",
        "sop_refs": ["POL-KYB-002 §2", "POL-KYB-002 §4"],
        "data_contract": ["entity.*", "facts.*", "graph.ownership", "evidence.*"],
        "permitted_recommendations": ["evidence_complete", "request_information", "escalate"],
        "success_criteria": {
            "min_reviewed_cases": 200,
            "min_agreement": 0.95,
            "max_severity_1_misses": 0,
            "p95_latency_ms": 6000,
        },
        # Gathering and presenting evidence is reversible and low materiality: this one can earn
        # bounded autonomy.
        "autonomy_ceiling": "auto_bounded",
    },
    {
        "key": "policy-qa",
        "task": "Answer a policy question from approved, in-force knowledge with citations",
        "sop_refs": ["POL-AOF-001 §9"],
        "data_contract": ["knowledge.*", "documents.*"],
        "permitted_recommendations": ["answer", "refuse"],
        "success_criteria": {
            "min_reviewed_cases": 200,
            "min_agreement": 0.98,
            "max_severity_1_misses": 0,
            "p95_latency_ms": 1500,
        },
        "autonomy_ceiling": "auto_bounded",
    },
    {
        "key": "monitoring-triage",
        "task": "Triage a monitoring alert and recommend the least intrusive effective intervention",
        "sop_refs": ["POL-MON-003 §2-§4", "POL-CB-001 §3"],
        "data_contract": [
            "entity.*",
            "merchant.*",
            "alerts.*",
            "screening.hits",
            "scores.merchant_risk",
            "graph.network",
        ],
        "permitted_recommendations": ["no_action", "watch", "request_information", "escalate"],
        "success_criteria": {
            "min_reviewed_cases": 500,
            "min_agreement": 0.95,
            "max_severity_1_misses": 0,
            "p95_latency_ms": 3000,
        },
        # Restrictions, holds and terminations are customer-detriment actions: excluded from the
        # permitted recommendations above and capped here.
        "autonomy_ceiling": "four_eyes",
        "autonomy_tier": "suggest",
    },
    {
        "key": "credit-exposure-review",
        "task": "Summarise merchant credit exposure and propose reserve or limit changes",
        "sop_refs": ["POL-CRD-002 §2-§4", "POL-CRD-002 §6"],
        "data_contract": [
            "entity.*",
            "merchant.*",
            "credit.summary",
            "scores.merchant_risk",
            "facts.registry.*",
        ],
        "permitted_recommendations": ["no_action", "escalate", "recommend_reserve", "recommend_cap"],
        "success_criteria": {
            "min_reviewed_cases": 300,
            "min_agreement": 0.97,
            "max_severity_1_misses": 0,
            "p95_latency_ms": 5000,
        },
        # Credit decisions and adverse actions can never be automated (POL-CRD-002 §6).
        "autonomy_ceiling": "four_eyes",
    },
]


def install(session: Session, *, validated_by: str = "risk.owner@pulse.example") -> list[str]:
    for spec in ARPS:
        agents.register_arp(
            session,
            key=spec["key"],
            task=spec["task"],
            sop_refs=spec["sop_refs"],
            data_contract=spec["data_contract"],
            success_criteria=spec["success_criteria"],
            permitted_recommendations=spec["permitted_recommendations"],
            autonomy_tier=spec.get("autonomy_tier", "shadow"),
            autonomy_ceiling=spec["autonomy_ceiling"],
            validated_by=validated_by,
        )
    return [spec["key"] for spec in ARPS]
