"""PLS-73 evaluation, backtest and drift; PLS-84/85 sandbox and experimentation.

Two failure modes matter here, and they are different:

* *Population drift* — the inputs move, so a model that was fair in January is scoring a different
  world in July. Detected on feature distributions.
* *Performance drift* — the agreement between what the system proposed and what accountable humans
  actually decided decays. Detected on labelled outcomes.

The consequence of the second is mechanical and deliberately unpleasant: an ARP whose agreement
falls below the floor is demoted, immediately, by this service rather than by a committee that meets
next month. Demotion needs no approval; promotion does.
"""

from __future__ import annotations

import datetime as dt
import math
import statistics
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ARP, AgentRun, Experiment, Merchant, OutcomeLabel, utcnow
from app.services import agents, audit, features


class EvaluationError(RuntimeError):
    """An evaluation or experiment that cannot be run as specified."""


def _psi(baseline: list[float], current: list[float], *, buckets: int = 5) -> float:
    """Population Stability Index — the standard drift measure on a continuous feature.

    Convention: < 0.10 stable, 0.10-0.25 moderate shift, > 0.25 material shift.
    """
    if len(baseline) < buckets or not current:
        return 0.0
    ordered = sorted(baseline)
    edges = [
        ordered[int(len(ordered) * (index + 1) / buckets) - 1] for index in range(buckets - 1)
    ]

    def share(values: list[float]) -> list[float]:
        counts = [0] * buckets
        for value in values:
            index = 0
            while index < len(edges) and value > edges[index]:
                index += 1
            counts[index] += 1
        total = len(values) or 1
        # Floor each share: a zero bucket makes the ratio undefined, not infinitely drifted.
        return [max(count / total, 1e-4) for count in counts]

    expected = share(baseline)
    actual = share(current)
    return round(
        sum(
            (actual[index] - expected[index]) * math.log(actual[index] / expected[index])
            for index in range(buckets)
        ),
        4,
    )


def feature_drift(
    session: Session, *, feature_keys: list[str] | None = None, window_days: int = 30
) -> dict[str, Any]:
    """Compare the recent feature population against the portfolio baseline."""
    merchants = session.execute(select(Merchant)).scalars().all()
    keys = feature_keys or [
        definition.key for definition in features.DEFINITIONS if definition.online
    ]
    cutoff = utcnow() - dt.timedelta(days=window_days)

    baseline: dict[str, list[float]] = {key: [] for key in keys}
    current: dict[str, list[float]] = {key: [] for key in keys}
    for merchant in merchants:
        vector = features.compute(session, merchant, keys)
        recent = merchant.boarded_at is not None and merchant.boarded_at >= cutoff
        for key in keys:
            value = vector["values"].get(key)
            if not isinstance(value, (int, float, bool)):
                continue
            baseline[key].append(float(value))
            if recent:
                current[key].append(float(value))

    findings: list[dict[str, Any]] = []
    for key in keys:
        psi = _psi(baseline[key], current[key])
        findings.append(
            {
                "feature": key,
                "baseline_n": len(baseline[key]),
                "recent_n": len(current[key]),
                "baseline_mean": round(statistics.fmean(baseline[key]), 4) if baseline[key] else None,
                "recent_mean": round(statistics.fmean(current[key]), 4) if current[key] else None,
                "psi": psi,
                "band": "material" if psi > 0.25 else "moderate" if psi > 0.10 else "stable",
            }
        )
    return {
        "window_days": window_days,
        "features": findings,
        "material_shifts": [item["feature"] for item in findings if item["band"] == "material"],
    }


def outcome_agreement(session: Session, arp_key: str) -> dict[str, Any]:
    """Agreement between agent recommendations and the labelled human outcome."""
    labels = session.execute(
        select(OutcomeLabel).where(OutcomeLabel.arp_key == arp_key)
    ).scalars().all()
    comparable = [
        label
        for label in labels
        if label.predicted is not None and label.observed is not None
    ]
    agreed = sum(1 for label in comparable if label.predicted == label.observed)
    runs = session.execute(
        select(AgentRun).where(AgentRun.arp_key == arp_key, AgentRun.human_outcome.isnot(None))
    ).scalars().all()
    run_agreed = sum(1 for run in runs if run.human_outcome == run.recommendation)
    observations = len(comparable) + len(runs)
    matches = agreed + run_agreed
    return {
        "arp": arp_key,
        "observations": observations,
        "agreement_rate": round(matches / observations, 4) if observations else 0.0,
        "labelled_outcomes": len(comparable),
        "reviewed_runs": len(runs),
        "false_positive_labels": sum(1 for label in labels if label.label == "false_positive"),
        "confirmed_labels": sum(1 for label in labels if label.label == "confirmed"),
    }


def drift_check(session: Session, arp_key: str, *, actor: str = "system") -> dict[str, Any]:
    """Assess an ARP for performance drift and demote it if it has fallen through the floor."""
    settings = get_settings()
    arp = agents.get_arp(session, arp_key)
    agreement = outcome_agreement(session, arp_key)
    observations = agreement["observations"]
    rate = agreement["agreement_rate"]

    breached = (
        observations >= settings.drift_min_observations and rate < settings.drift_agreement_floor
    )
    demoted_to: str | None = None
    if breached and agents.TIER_RANK[arp.autonomy_tier] > 0:
        demoted_to = agents.TIERS[agents.TIER_RANK[arp.autonomy_tier] - 1]
        _demote(
            session,
            arp,
            to_tier=demoted_to,
            actor=actor,
            reason=(
                f"agreement {rate:.2%} below floor {settings.drift_agreement_floor:.2%} "
                f"over {observations} observation(s)"
            ),
        )
    return {
        **agreement,
        "agreement_floor": settings.drift_agreement_floor,
        "min_observations": settings.drift_min_observations,
        "sufficient_evidence": observations >= settings.drift_min_observations,
        "breached": breached,
        "autonomy_tier": arp.autonomy_tier,
        "canonical_tier": agents.CANONICAL_TIER[arp.autonomy_tier],
        "demoted_to": demoted_to,
    }


def _demote(session: Session, arp: ARP, *, to_tier: str, actor: str, reason: str) -> None:
    """Demotion bypasses the promotion gate on purpose: reducing autonomy is always safe."""
    previous = arp.autonomy_tier
    arp.autonomy_tier = to_tier
    arp.tier_history = [
        *(arp.tier_history or []),
        {
            "from": previous,
            "to": to_tier,
            "actor": actor,
            "rationale": reason,
            "drift_demotion": True,
            "at": utcnow().isoformat(),
        },
    ]
    session.flush()
    audit.append(
        session,
        actor=actor,
        actor_role="system",
        action="arp.drift_demotion",
        subject_type="arp",
        subject_id=arp.id,
        payload={"from": previous, "to": to_tier, "reason": reason},
    )


def sweep(session: Session, *, actor: str = "system") -> dict[str, Any]:
    """Run the drift check across every registered ARP — the scheduled governance job."""
    arps = session.execute(select(ARP)).scalars().all()
    reports = [drift_check(session, arp.key, actor=actor) for arp in arps]
    return {
        "arps_checked": len(reports),
        "breaches": [report for report in reports if report["breached"]],
        "demotions": [report["arp"] for report in reports if report["demoted_to"]],
        "reports": reports,
    }


def register_experiment(
    session: Session,
    *,
    key: str,
    hypothesis: str,
    owner: str,
    scope: str,
    control: str,
    variant: str,
    metric: str,
    guardrail_metric: str,
    min_observations: int = 50,
) -> Experiment:
    """Register a shadow-mode experiment (PLS-85). Experiments never affect live outcomes."""
    existing = session.execute(select(Experiment).where(Experiment.key == key)).scalars().first()
    if existing is not None:
        raise EvaluationError(f"experiment '{key}' is already registered")
    row = Experiment(
        key=key,
        hypothesis=hypothesis,
        owner=owner,
        scope=scope,
        control=control,
        variant=variant,
        metric=metric,
        guardrail_metric=guardrail_metric,
        min_observations=min_observations,
        state="shadow",
    )
    session.add(row)
    session.flush()
    audit.append(
        session,
        actor=owner,
        actor_role="model_risk",
        action="experiment.registered",
        subject_type="experiment",
        subject_id=row.id,
        payload={"key": key, "control": control, "variant": variant, "metric": metric},
    )
    return row


def record_observation(
    session: Session,
    key: str,
    *,
    arm: str,
    metric_value: float,
    guardrail_value: float | None = None,
) -> Experiment:
    row = session.execute(select(Experiment).where(Experiment.key == key)).scalars().first()
    if row is None:
        raise LookupError(f"unknown experiment '{key}'")
    if arm not in {"control", "variant"}:
        raise EvaluationError(f"arm must be control or variant, got '{arm}'")
    observations = list(row.observations or [])
    observations.append(
        {
            "arm": arm,
            "metric": metric_value,
            "guardrail": guardrail_value,
            "at": utcnow().isoformat(),
        }
    )
    row.observations = observations
    session.flush()
    return row


def experiment_result(session: Session, key: str) -> dict[str, Any]:
    row = session.execute(select(Experiment).where(Experiment.key == key)).scalars().first()
    if row is None:
        raise LookupError(f"unknown experiment '{key}'")
    observations = list(row.observations or [])
    arms: dict[str, list[float]] = {"control": [], "variant": []}
    guardrails: dict[str, list[float]] = {"control": [], "variant": []}
    for item in observations:
        arm = str(item.get("arm"))
        if arm not in arms:
            continue
        arms[arm].append(float(item.get("metric", 0.0)))
        guardrail = item.get("guardrail")
        if isinstance(guardrail, (int, float)):
            guardrails[arm].append(float(guardrail))

    control_mean = statistics.fmean(arms["control"]) if arms["control"] else None
    variant_mean = statistics.fmean(arms["variant"]) if arms["variant"] else None
    enough = min(len(arms["control"]), len(arms["variant"])) >= row.min_observations
    guardrail_breached = bool(
        guardrails["variant"]
        and guardrails["control"]
        and statistics.fmean(guardrails["variant"]) > statistics.fmean(guardrails["control"])
    )
    return {
        "key": row.key,
        "state": row.state,
        "hypothesis": row.hypothesis,
        "owner": row.owner,
        "metric": row.metric,
        "guardrail_metric": row.guardrail_metric,
        "control": {"arm": row.control, "n": len(arms["control"]), "mean": control_mean},
        "variant": {"arm": row.variant, "n": len(arms["variant"]), "mean": variant_mean},
        "min_observations": row.min_observations,
        "sufficient_evidence": enough,
        "guardrail_breached": guardrail_breached,
        "conclusion": _conclude(control_mean, variant_mean, enough, guardrail_breached),
    }


def _conclude(
    control_mean: float | None,
    variant_mean: float | None,
    enough: bool,
    guardrail_breached: bool,
) -> str:
    if not enough:
        return "inconclusive: insufficient observations"
    if guardrail_breached:
        return "rejected: guardrail metric degraded"
    if control_mean is None or variant_mean is None:
        return "inconclusive: an arm has no observations"
    if variant_mean > control_mean:
        return "variant ahead on the primary metric; eligible for promotion review"
    return "no improvement over control"
