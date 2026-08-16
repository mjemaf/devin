"""PLS-74 explanation, adverse action and decision replay.

Three obligations sit on the same recorded decision:

* an *analyst* explanation — which rules fired, on which facts, from which sources, and what would
  have had to be different;
* an *adverse action* notice — the customer-facing subset, in plain language, with no internal model
  names, thresholds or third-party vendor detail; and
* a *replay* — re-running the recorded facts through the recorded policy version and asserting the
  same outcome, which is what makes the bi-temporal claim (C3) testable rather than aspirational.

A replay divergence is not automatically a defect: it can mean the policy pack on disk has moved on.
The report separates the two so the reader can tell which happened.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Decision, Entity, utcnow
from app.services import audit, policy, provenance

# Customer-facing wording per reason code. Anything absent falls back to the rule description, and
# never to the raw expression: expressions leak thresholds.
CUSTOMER_LANGUAGE: dict[str, str] = {
    "SANCTIONS_MATCH": (
        "We were unable to verify that the business and its owners are eligible "
        "for our services."
    ),
    "PEP_EXPOSURE": (
        "Additional verification of the business's ownership was required "
        "and could not be completed."
    ),
    "ADVERSE_MEDIA": (
        "Publicly available information about the business could not be reconciled "
        "with the information provided."
    ),
    "UBO_INCOMPLETE": (
        "We could not establish the beneficial ownership of the business to the standard "
        "we are required to meet."
    ),
    "UBO_UNVERIFIED": "We could not verify the identity of one or more beneficial owners.",
    "HIGH_RISK_MCC": "The business activity falls outside the categories we are able to support.",
    "PROHIBITED_ACTIVITY": "The business activity falls outside the categories we are able to support.",
    "CHARGEBACK_EXCESSIVE": "The level of disputes on the account exceeded the level we are able to support.",
    "VOLUME_DEVIATION": (
        "Processing activity was materially different from the activity described "
        "in the application."
    ),
    "CREDIT_LIMIT_EXCEEDED": "The credit exposure required exceeds what we are able to extend.",
    "REGISTRY_MISMATCH": "Information from the company registry did not match the information provided.",
    "LINKED_TO_OFFBOARDED": "The business is connected to a relationship we previously ended.",
    "DOC_OUTSTANDING": "Information we requested was not provided within the time allowed.",
}

ADVERSE_OUTCOMES = frozenset({"decline", "terminate", "restrict", "limit_decrease"})


class ExplainError(RuntimeError):
    """A decision that cannot be explained or replayed as recorded."""


def _reason_entries(decision: Decision) -> list[dict[str, Any]]:
    """Normalise reason codes, which are recorded either as strings or as dicts."""
    entries: list[dict[str, Any]] = []
    for item in decision.reason_codes:
        if isinstance(item, dict):
            code = str(item.get("code") or item.get("reason_code") or "UNSPECIFIED")
            entries.append(
                {
                    "code": code,
                    "description": str(item.get("description") or ""),
                    "rule_id": item.get("rule_id"),
                    "sop_ref": item.get("sop_ref"),
                }
            )
        else:
            entries.append(
                {"code": str(item), "description": "", "rule_id": None, "sop_ref": None}
            )
    return entries


def explain(session: Session, decision_id: int) -> dict[str, Any]:
    """The analyst-facing explanation: rules, facts, provenance, counterfactuals, accountability."""
    decision = session.get(Decision, decision_id)
    if decision is None:
        raise LookupError(f"unknown decision {decision_id}")

    fired = [result for result in decision.rule_results if result.get("fired")]
    citations = provenance.citation_bundle(
        session, decision.entity_id, sorted(decision.facts_relied.keys())
    )
    return {
        "decision_id": decision.id,
        "entity_id": decision.entity_id,
        "decision_type": decision.decision_type,
        "outcome": decision.outcome,
        "as_of": decision.as_of,
        "jurisdiction": decision.jurisdiction,
        "policy": {
            "pack": decision.policy_pack,
            "version": decision.policy_version,
        },
        "reason_codes": _reason_entries(decision),
        "rules_fired": [
            {
                "rule_id": result.get("rule_id"),
                "description": result.get("description"),
                "outcome": result.get("outcome"),
                "sop_ref": result.get("sop_ref"),
                "expression": result.get("expression"),
            }
            for result in fired
        ],
        "rules_evaluated": len(decision.rule_results),
        "facts_relied": decision.facts_relied,
        "fact_provenance": decision.fact_provenance or citations,
        "counterfactuals": decision.counterfactuals,
        "materiality": decision.materiality,
        "required_oversight": decision.required_oversight,
        "model_versions": decision.model_versions,
        "confidence": decision.confidence,
        "degraded_checks": decision.degraded_checks,
        "accountable_party": decision.accountable_party or decision.actor,
        "accountable_at": decision.accountable_at or decision.as_of,
        "agent_run_id": decision.agent_run_id,
    }


def adverse_action(
    session: Session,
    decision_id: int,
    *,
    issued_by: str,
    record: bool = True,
) -> dict[str, Any]:
    """Generate the customer-facing notice for an adverse decision.

    The notice deliberately omits model names, thresholds, scores and vendor identities: those are
    internal, and in several jurisdictions disclosing them is prohibited rather than merely unwise.
    """
    decision = session.get(Decision, decision_id)
    if decision is None:
        raise LookupError(f"unknown decision {decision_id}")
    if decision.outcome not in ADVERSE_OUTCOMES:
        raise ExplainError(
            f"decision {decision_id} outcome '{decision.outcome}' is not adverse; "
            "no notice is required"
        )
    entity = session.get(Entity, decision.entity_id)
    if entity is None:
        raise LookupError(f"unknown entity {decision.entity_id}")

    entries = _reason_entries(decision)
    reasons: list[dict[str, str]] = []
    for entry in entries:
        text = CUSTOMER_LANGUAGE.get(entry["code"]) or entry["description"]
        if not text:
            continue
        reasons.append({"code": entry["code"], "statement": text})
    if not reasons:
        raise ExplainError(
            f"decision {decision_id} has no reason codes; an adverse notice cannot be issued "
            "without a stated reason"
        )

    notice = {
        "decision_id": decision.id,
        "entity_id": entity.id,
        "entity_name": entity.legal_name,
        "outcome": decision.outcome,
        "decision_date": decision.as_of,
        "reasons": reasons,
        "review_rights": (
            "You may request a review of this decision and provide additional information "
            "within 30 days of the date of this notice."
        ),
        "contact": "risk.reviews@pulse.example",
        "issued_by": issued_by,
        "issued_at": utcnow(),
        "internal_detail_withheld": True,
    }
    if record:
        audit.append(
            session,
            actor=issued_by,
            actor_role="analyst",
            action="adverse_action.issued",
            subject_type="decision",
            subject_id=decision.id,
            payload={
                "entity_id": entity.id,
                "outcome": decision.outcome,
                "reason_codes": [reason["code"] for reason in reasons],
            },
        )
    return notice


def replay(session: Session, decision_id: int) -> dict[str, Any]:
    """Re-evaluate a recorded decision against its recorded facts and policy version."""
    decision = session.get(Decision, decision_id)
    if decision is None:
        raise LookupError(f"unknown decision {decision_id}")
    if not decision.facts_relied:
        return {
            "decision_id": decision.id,
            "replayable": False,
            "reason": "no fact set was recorded with this decision",
        }

    as_of_date: dt.date = decision.as_of.date()
    try:
        evaluation = policy.evaluate(
            decision.policy_pack,
            dict(decision.facts_relied),
            as_of=as_of_date,
            jurisdiction=decision.jurisdiction,
        )
    except policy.PolicyError as exc:
        return {
            "decision_id": decision.id,
            "replayable": False,
            "reason": str(exc),
        }

    pack_moved = evaluation.version != decision.policy_version
    matches = evaluation.outcome == decision.outcome
    original_codes = sorted(entry["code"] for entry in _reason_entries(decision))
    replayed_codes = sorted(
        str(item.get("code", item)) if isinstance(item, dict) else str(item)
        for item in evaluation.reason_codes
    )
    return {
        "decision_id": decision.id,
        "replayable": True,
        "as_of": decision.as_of,
        "recorded_outcome": decision.outcome,
        "replayed_outcome": evaluation.outcome,
        "outcome_matches": matches,
        "recorded_policy_version": decision.policy_version,
        "replayed_policy_version": evaluation.version,
        "policy_version_moved": pack_moved,
        "recorded_reason_codes": original_codes,
        "replayed_reason_codes": replayed_codes,
        "reason_codes_match": original_codes == replayed_codes,
        "divergence_explained_by_policy_change": (not matches) and pack_moved,
    }


def replay_all(session: Session, *, limit: int = 200) -> dict[str, Any]:
    """A portfolio-level replay attestation — what an examiner asks for, not a single case."""
    rows = session.execute(
        select(Decision).order_by(Decision.id.desc()).limit(limit)
    ).scalars().all()
    reports = [replay(session, row.id) for row in rows]
    replayable = [report for report in reports if report.get("replayable")]
    mismatched = [report for report in replayable if not report.get("outcome_matches")]
    return {
        "decisions_examined": len(reports),
        "replayable": len(replayable),
        "not_replayable": len(reports) - len(replayable),
        "outcome_matches": len(replayable) - len(mismatched),
        "divergences": mismatched,
        "unexplained_divergences": [
            report
            for report in mismatched
            if not report.get("divergence_explained_by_policy_change")
        ],
    }
