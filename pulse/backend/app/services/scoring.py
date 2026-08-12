"""Risk scoring and peer cohorts — transparent, reproducible, and explainable by construction.

A deliberately additive, weight-per-signal model rather than a black box: at this stage of a risk
platform the binding constraint is defensibility, not marginal AUC. Every score persists its
feature vector, per-feature contributions and an inputs hash, so a score can be recomputed and
proved to be the one a decision relied on (SR 11-7 model documentation and outcome analysis).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import statistics
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Merchant, Score

# signal key -> (weight, human explanation)
MODEL_KEY = "merchant_risk"
MODEL_VERSION = "1.2.0"

SIGNAL_WEIGHTS: dict[str, tuple[float, str]] = {
    "sanctions_true_match": (40.0, "Confirmed sanctions match"),
    "negative_file_match": (22.0, "Party appears on the internal negative file"),
    "linked_to_offboarded": (18.0, "Linked to an entity off-boarded for cause"),
    "adverse_media": (12.0, "Credible adverse media"),
    "pep_exposure": (8.0, "Politically exposed person in the ownership chain"),
    "registry_mismatch": (10.0, "Applicant data conflicts with the register"),
    "ubo_unresolved": (12.0, "Beneficial ownership not fully established"),
    "entity_inactive": (15.0, "Company not active on the register"),
    "thin_credit_file": (8.0, "No filed financial history"),
    "weak_credit_score": (10.0, "Weak bureau credit profile"),
    "chargebacks": (14.0, "Chargeback rate relative to scheme thresholds"),
    "volume_vs_underwritten": (9.0, "Volume above underwritten expectation"),
    "model_drift": (11.0, "Business model differs from what was underwritten"),
    "high_risk_mcc": (7.0, "Elevated-risk merchant category"),
    "high_risk_country": (9.0, "High-risk jurisdiction"),
    "network_density": (8.0, "Dense related-party network"),
    "tenure": (-6.0, "Long, clean tenure reduces risk"),
}

HIGH_RISK_MCC = {"5966", "5967", "7273", "7995", "4816", "5122", "5912", "6051"}
HIGH_RISK_COUNTRIES = {"IR", "KP", "SY", "RU", "MM", "BY", "CU"}

BANDS = ((75.0, "critical"), (55.0, "high"), (35.0, "medium"), (0.0, "low"))


@dataclass
class Contribution:
    signal: str
    value: float
    weight: float
    points: float
    explanation: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "signal": self.signal,
            "value": round(self.value, 4),
            "weight": self.weight,
            "points": round(self.points, 2),
            "explanation": self.explanation,
        }


@dataclass
class ScoreResult:
    entity_id: int
    model_key: str
    model_version: str
    value: float
    band: str
    contributions: list[Contribution] = field(default_factory=list)
    features: dict[str, Any] = field(default_factory=dict)
    inputs_hash: str = ""
    peer_percentile: float | None = None
    peer_cohort: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "model_key": self.model_key,
            "model_version": self.model_version,
            "value": round(self.value, 2),
            "band": self.band,
            "peer_percentile": self.peer_percentile,
            "peer_cohort": self.peer_cohort,
            "contributions": [c.as_dict() for c in self.contributions],
            "features": self.features,
            "inputs_hash": self.inputs_hash,
        }


def _band(value: float) -> str:
    for floor, name in BANDS:
        if value >= floor:
            return name
    return "low"


def build_signals(
    *,
    screening: dict[str, Any] | None = None,
    kyb: dict[str, Any] | None = None,
    network: dict[str, Any] | None = None,
    credit: dict[str, Any] | None = None,
    merchant: Merchant | None = None,
) -> dict[str, float]:
    """Normalise heterogeneous evidence into 0..1 signal strengths."""
    screening = screening or {}
    kyb = kyb or {}
    network = network or {}
    credit = credit or {}
    hits = screening.get("hits", [])

    signals: dict[str, float] = {
        "sanctions_true_match": 1.0 if screening.get("sanctions_true_match") else 0.0,
        "negative_file_match": max(
            (h["score"] for h in hits if h["list_type"] == "negative_file" and h["actionable"]),
            default=0.0,
        ),
        "pep_exposure": 1.0 if screening.get("pep_exposure") else 0.0,
        "adverse_media": float(screening.get("adverse_media_score") or 0.0),
        "linked_to_offboarded": max(
            (
                flag.get("path_strength", 0.8)
                for flag in network.get("risk_flags", [])
                if flag["flag"] == "linked_to_offboarded_entity"
            ),
            default=0.0,
        ),
        "network_density": min(1.0, len(network.get("neighbours", [])) / 8.0),
        "registry_mismatch": min(
            1.0,
            sum(
                1.0 if m["severity"] in {"high", "critical"} else 0.4
                for m in kyb.get("mismatches", [])
            )
            / 2.0,
        ),
        "ubo_unresolved": min(1.0, float(kyb.get("unresolved_ownership_percentage") or 0.0) / 50.0),
        "entity_inactive": 0.0
        if (kyb.get("registry_status") in (None, "active"))
        else 1.0,
        "thin_credit_file": 1.0 if credit.get("thin_file") else 0.0,
        "weak_credit_score": max(0.0, (60.0 - float(credit.get("credit_score", 60))) / 60.0),
    }

    if merchant is not None:
        # 0.9% is the scheme monitoring threshold; treat 2% as fully saturated.
        signals["chargebacks"] = min(1.0, max(0.0, (merchant.chargeback_rate - 0.003) / 0.017))
        underwritten = max(merchant.credit_limit, 1.0)
        signals["volume_vs_underwritten"] = min(
            1.0, max(0.0, (merchant.monthly_volume / underwritten - 1.0) / 2.0)
        )
        drift = bool(
            merchant.underwritten_business_model
            and merchant.business_model
            and merchant.underwritten_business_model != merchant.business_model
        ) or bool(
            merchant.underwritten_mcc and merchant.mcc and merchant.underwritten_mcc != merchant.mcc
        )
        signals["model_drift"] = 1.0 if drift else 0.0
        signals["high_risk_mcc"] = 1.0 if (merchant.mcc or "") in HIGH_RISK_MCC else 0.0
        if merchant.boarded_at is not None:
            years = (dt.datetime.now(dt.timezone.utc) - _aware(merchant.boarded_at)).days / 365.0
            signals["tenure"] = min(1.0, years / 5.0)

    country = (kyb.get("country") or "").upper()
    signals["high_risk_country"] = 1.0 if country in HIGH_RISK_COUNTRIES else 0.0
    return signals


def _aware(value: dt.datetime) -> dt.datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=dt.timezone.utc)


def score(
    session: Session,
    entity_id: int,
    signals: dict[str, float],
    *,
    persist: bool = True,
    cohort_key: str | None = None,
) -> ScoreResult:
    contributions: list[Contribution] = []
    total = 0.0
    for key, (weight, explanation) in SIGNAL_WEIGHTS.items():
        value = float(signals.get(key, 0.0))
        if value == 0.0:
            continue
        points = weight * value
        total += points
        contributions.append(Contribution(key, value, weight, points, explanation))

    value = round(min(100.0, max(0.0, total)), 2)
    contributions.sort(key=lambda c: -abs(c.points))
    inputs_hash = hashlib.sha256(
        json.dumps({"signals": signals, "version": MODEL_VERSION}, sort_keys=True).encode()
    ).hexdigest()

    result = ScoreResult(
        entity_id=entity_id,
        model_key=MODEL_KEY,
        model_version=MODEL_VERSION,
        value=value,
        band=_band(value),
        contributions=contributions,
        features=signals,
        inputs_hash=inputs_hash,
    )

    if cohort_key:
        result.peer_cohort = cohort_key
        result.peer_percentile = peer_percentile(session, cohort_key, value)

    if persist:
        session.add(
            Score(
                entity_id=entity_id,
                model_key=MODEL_KEY,
                model_version=MODEL_VERSION,
                value=value,
                band=result.band,
                peer_percentile=result.peer_percentile,
                contributions=[c.as_dict() for c in contributions],
                features=signals,
                inputs_hash=inputs_hash,
            )
        )
        session.flush()
    return result


def peer_percentile(session: Session, cohort_key: str, value: float) -> float | None:
    """Where this score sits within its MCC/segment cohort — outliers, not absolutes."""
    mcc, _, segment = cohort_key.partition(":")
    merchant_ids = [
        m.entity_id
        for m in session.execute(
            select(Merchant).where(Merchant.mcc == mcc, Merchant.segment == (segment or "smb"))
        ).scalars()
    ]
    if not merchant_ids:
        return None
    peers: list[float] = []
    for entity_id in merchant_ids:
        latest = session.execute(
            select(Score)
            .where(Score.entity_id == entity_id, Score.model_key == MODEL_KEY)
            .order_by(Score.as_of.desc())
        ).scalars().first()
        if latest is not None:
            peers.append(latest.value)
    if not peers:
        return None
    below = sum(1 for peer in peers if peer < value)
    return round(below / len(peers), 3)


@dataclass
class _CohortMember:
    name: str
    risk_score: float
    chargeback_rate: float


def cohort_stats(session: Session) -> list[dict[str, Any]]:
    """Cohort view for portfolio surveillance: a merchant is judged against its peers, not an
    absolute threshold, so both the risk score and the chargeback rate are reported per cohort."""
    grouped: dict[str, list[_CohortMember]] = {}
    for merchant in session.execute(select(Merchant)).scalars():
        latest = session.execute(
            select(Score)
            .where(Score.entity_id == merchant.entity_id, Score.model_key == MODEL_KEY)
            .order_by(Score.as_of.desc())
        ).scalars().first()
        if latest is None:
            continue
        grouped.setdefault(f"{merchant.mcc or 'unknown'}:{merchant.segment}", []).append(
            _CohortMember(
                name=merchant.display_name,
                risk_score=latest.value,
                chargeback_rate=merchant.chargeback_rate or 0.0,
            )
        )

    out: list[dict[str, Any]] = []
    for cohort, members in sorted(grouped.items()):
        scores = [member.risk_score for member in members]
        rates = [member.chargeback_rate for member in members]
        median_score = statistics.median(scores)
        p90_score = max(scores) if len(scores) < 10 else statistics.quantiles(scores, n=10)[8]
        out.append(
            {
                "cohort": cohort,
                "merchants": len(members),
                "median_risk_score": round(median_score, 2),
                "p90_risk_score": round(p90_score, 2),
                "median_chargeback_rate": round(statistics.median(rates), 5),
                "max_chargeback_rate": round(max(rates), 5),
                "outliers": [
                    member.name
                    for member in members
                    if member.risk_score >= max(median_score * 1.5, 55.0)
                ],
            }
        )
    return out
