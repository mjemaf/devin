"""PLS-71 Model Risk Management registry (SR 11-7 shaped).

Registration is not documentation: :mod:`app.services.ai_gateway` and
:mod:`app.services.agents` refuse to run an artefact that is not registered and ``validated`` for the
purpose being requested. Rule sets, prompts, scorecards and agent pathways are all artefacts — the
architecture treats a deterministic rule pack with the same seriousness as a model, because both
drive consequential outcomes.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ModelArtefact, utcnow
from app.services import audit

STATES = ("draft", "validated", "monitored", "retired", "suspended")


class RegistryError(RuntimeError):
    """An artefact is missing, unvalidated, retired or not approved for this purpose."""


# Everything the reference build actually executes. A production registry entry would also carry the
# validation report reference and the fair-lending review; the shape is the same.
ARTEFACTS: tuple[dict[str, Any], ...] = (
    {
        "key": "merchant-risk-scorecard",
        "version": "2",
        "artefact_type": "model",
        "purpose": "Rank merchant risk for triage and monitoring prioritisation",
        "approved_use": ["risk_scoring", "monitoring_prioritisation"],
        "limitations": [
            "not a credit decision model",
            "not calibrated for merchants under 3 months of trading history",
        ],
        "feature_set": [
            "screening.sanctions_true_match",
            "network.linked_to_offboarded",
            "merchant.chargeback_rate",
            "merchant.volume_ratio",
            "merchant.model_drift",
        ],
        "fair_lending_relevant": False,
        "monitoring_plan": "Cohort drift and override rate reviewed monthly; demotion on drift.",
        "state": "monitored",
    },
    {
        "key": "onboarding-policy-pack",
        "version": "1",
        "artefact_type": "rule_set",
        "purpose": "Deterministic boarding decision with reason codes",
        "approved_use": ["boarding_decision"],
        "limitations": ["jurisdiction overlays required outside the base pack"],
        "fair_lending_relevant": True,
        "bias_exposure": "Declines are adverse actions; reason codes are the notice content.",
        "monitoring_plan": "Reason-code distribution and override rate reviewed monthly.",
        "state": "validated",
    },
    {
        "key": "monitoring-policy-pack",
        "version": "1",
        "artefact_type": "rule_set",
        "purpose": "Deterministic post-boarding intervention selection",
        "approved_use": ["monitoring_decision"],
        "limitations": ["intervention severity capped by materiality"],
        "state": "validated",
    },
    {
        "key": "grounded-answer-composer",
        "version": "1",
        "artefact_type": "prompt",
        "purpose": "Compose an extractive answer strictly from retrieved approved passages",
        "approved_use": ["policy_qa"],
        "limitations": [
            "refuses below the grounding floor",
            "may not answer from anything but retrieved passages",
        ],
        "monitoring_plan": "Refusal rate, citation coverage and analyst feedback reviewed weekly.",
        "state": "monitored",
    },
    {
        "key": "screening-match-scorer",
        "version": "1",
        "artefact_type": "model",
        "purpose": "Score name/identifier similarity for watchlist candidates",
        "approved_use": ["screening"],
        "limitations": ["discounting a sanctions match may never be automated"],
        "state": "validated",
    },
    {
        "key": "entity-resolution-matcher",
        "version": "1",
        "artefact_type": "model",
        "purpose": "Score candidate entity matches for canonicalisation",
        "approved_use": ["entity_resolution"],
        "limitations": ["auto-merge only above the configured confidence band"],
        "state": "validated",
    },
)


def install(session: Session, *, validated_by: str = "model.risk@pulse.example") -> list[str]:
    for spec in ARTEFACTS:
        register(session, actor=validated_by, **spec)
    return [str(spec["key"]) for spec in ARTEFACTS]


def register(
    session: Session,
    *,
    key: str,
    version: str = "1",
    artefact_type: str = "model",
    purpose: str = "",
    approved_use: list[str] | None = None,
    limitations: list[str] | None = None,
    feature_set: list[str] | None = None,
    training_data_ref: str | None = None,
    bias_exposure: str | None = None,
    fair_lending_relevant: bool = False,
    validation_evidence: str | None = None,
    monitoring_plan: str | None = None,
    residency: str = "global",
    barred_classifications: list[str] | None = None,
    state: str = "draft",
    actor: str = "model.risk@pulse.example",
) -> ModelArtefact:
    if state not in STATES:
        raise ValueError(f"unknown artefact state '{state}'")
    artefact = session.execute(
        select(ModelArtefact).where(ModelArtefact.key == key, ModelArtefact.version == version)
    ).scalars().first()
    created = artefact is None
    if artefact is None:
        artefact = ModelArtefact(key=key, version=version)
        session.add(artefact)
    artefact.artefact_type = artefact_type
    artefact.purpose = purpose
    artefact.approved_use = approved_use or []
    artefact.limitations = limitations or []
    artefact.feature_set = feature_set or []
    artefact.training_data_ref = training_data_ref
    artefact.bias_exposure = bias_exposure
    artefact.fair_lending_relevant = fair_lending_relevant
    artefact.validation_evidence = validation_evidence
    artefact.monitoring_plan = monitoring_plan
    artefact.residency = residency
    artefact.barred_classifications = barred_classifications or []
    artefact.state = state
    artefact.owner = actor
    if state in {"validated", "monitored"} and artefact.validated_at is None:
        artefact.validated_by = actor
        artefact.validated_at = utcnow()
        artefact.revalidation_due = utcnow() + dt.timedelta(days=365)
    session.flush()
    if created:
        audit.append(
            session,
            actor=actor,
            actor_role="second_line",
            action="mrm.artefact_registered",
            subject_type="model_artefact",
            subject_id=artefact.id,
            payload={"key": key, "version": version, "type": artefact_type, "state": state},
        )
    return artefact


def get(session: Session, key: str, version: str | None = None) -> ModelArtefact:
    stmt = select(ModelArtefact).where(ModelArtefact.key == key)
    if version:
        stmt = stmt.where(ModelArtefact.version == version)
    artefact = session.execute(stmt.order_by(ModelArtefact.version.desc())).scalars().first()
    if artefact is None:
        raise RegistryError(f"artefact '{key}' is not registered (PLS-71)")
    return artefact


def require_runnable(
    session: Session, key: str, *, purpose: str, version: str | None = None
) -> ModelArtefact:
    """The gate every inference and pathway run passes through."""
    artefact = get(session, key, version)
    if artefact.state not in {"validated", "monitored"}:
        raise RegistryError(
            f"artefact '{key}' v{artefact.version} is '{artefact.state}' and may not execute"
        )
    if artefact.approved_use and purpose not in artefact.approved_use:
        raise RegistryError(
            f"artefact '{key}' is not approved for '{purpose}' "
            f"(approved: {', '.join(artefact.approved_use)})"
        )
    if artefact.revalidation_due is not None and artefact.revalidation_due < utcnow():
        raise RegistryError(f"artefact '{key}' v{artefact.version} is overdue revalidation")
    return artefact


def set_state(
    session: Session, key: str, version: str, *, state: str, actor: str, reason: str
) -> ModelArtefact:
    if state not in STATES:
        raise ValueError(f"unknown artefact state '{state}'")
    artefact = get(session, key, version)
    previous = artefact.state
    artefact.state = state
    artefact.change_history = [
        *(artefact.change_history or []),
        {"from": previous, "to": state, "actor": actor, "reason": reason, "at": utcnow().isoformat()},
    ]
    session.flush()
    audit.append(
        session,
        actor=actor,
        actor_role="second_line",
        action="mrm.state_changed",
        subject_type="model_artefact",
        subject_id=artefact.id,
        payload={"key": key, "version": version, "from": previous, "to": state, "reason": reason},
    )
    return artefact


def serialise(artefact: ModelArtefact) -> dict[str, Any]:
    return {
        "key": artefact.key,
        "version": artefact.version,
        "artefact_type": artefact.artefact_type,
        "purpose": artefact.purpose,
        "owner": artefact.owner,
        "approved_use": artefact.approved_use,
        "limitations": artefact.limitations,
        "feature_set": artefact.feature_set,
        "fair_lending_relevant": artefact.fair_lending_relevant,
        "bias_exposure": artefact.bias_exposure,
        "monitoring_plan": artefact.monitoring_plan,
        "state": artefact.state,
        "residency": artefact.residency,
        "validated_by": artefact.validated_by,
        "validated_at": artefact.validated_at,
        "revalidation_due": artefact.revalidation_due,
        "change_history": artefact.change_history,
    }


def inventory(session: Session) -> list[dict[str, Any]]:
    rows = session.execute(
        select(ModelArtefact).order_by(ModelArtefact.key, ModelArtefact.version)
    ).scalars().all()
    return [serialise(row) for row in rows]
