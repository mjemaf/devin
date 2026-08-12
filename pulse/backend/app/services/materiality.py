"""Materiality as a shared platform function.

The AOF's core insight: how much autonomy an action may have is a function of the *consequence*, not
the confidence of the model. So materiality is computed once, centrally, from reversibility,
customer impact, financial exposure, regulatory exposure and precedent — and every autonomy
decision consumes it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings

# Actions that can never be fully automated, whatever the score says.
NEVER_AUTOMATED: dict[str, str] = {
    "decline": "adverse action with regulatory notice obligations",
    "terminate": "irreversible loss of the customer relationship",
    "credit_limit_increase": "credit decision",
    "credit_decision": "credit decision",
    "file_sar": "law-enforcement filing",
    "adverse_action_notice": "adverse action with regulatory notice obligations",
    "hold_funds": "customer detriment and potential complaint exposure",
    "restrict": "customer detriment",
}

# The autonomy each materiality level permits, absent a permanent ceiling on the action itself.
LEVEL_AUTONOMY: dict[str, str] = {
    "low": "auto_bounded",
    "medium": "suggest",
    "high": "four_eyes",
    "critical": "four_eyes",
}

REVERSIBILITY: dict[str, float] = {
    "no_action": 1.0,
    "watch": 1.0,
    "request_information": 0.95,
    "refresh_kyb": 1.0,
    "add_note": 1.0,
    "reserve_increase": 0.7,
    "limit_decrease": 0.7,
    "restrict": 0.5,
    "hold_funds": 0.4,
    "approve_with_conditions": 0.3,
    "approve": 0.25,
    "decline": 0.1,
    "terminate": 0.0,
    "file_sar": 0.0,
}


@dataclass
class Materiality:
    level: str  # low | medium | high | critical
    score: float
    drivers: list[str] = field(default_factory=list)
    permitted_autonomy: str = "four_eyes"
    ceiling_reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "level": self.level,
            "score": round(self.score, 3),
            "drivers": self.drivers,
            "permitted_autonomy": self.permitted_autonomy,
            "ceiling_reason": self.ceiling_reason,
        }


def assess(
    *,
    action: str,
    financial_exposure: float = 0.0,
    customers_affected: int = 0,
    regulatory_notice_required: bool = False,
    sets_precedent: bool = False,
    risk_band: str = "low",
) -> Materiality:
    settings = get_settings()
    drivers: list[str] = []
    score = 0.0

    reversibility = REVERSIBILITY.get(action, 0.3)
    score += (1.0 - reversibility) * 0.4
    if reversibility <= 0.4:
        drivers.append(f"action '{action}' is hard or impossible to reverse")

    exposure_ratio = min(1.0, financial_exposure / max(settings.materiality_exposure_ceiling, 1.0))
    score += exposure_ratio * 0.3
    if exposure_ratio >= 0.5:
        drivers.append(f"financial exposure of {financial_exposure:,.0f} is material")

    if customers_affected:
        impact = min(1.0, customers_affected / 100.0)
        score += impact * 0.1
        if customers_affected > 1:
            drivers.append(f"{customers_affected} customers affected")

    if regulatory_notice_required:
        score += 0.15
        drivers.append("a regulatory or adverse-action notice is required")

    if sets_precedent:
        score += 0.05
        drivers.append("the outcome would set precedent for similar cases")

    if risk_band in {"high", "critical"}:
        score += 0.05
        drivers.append(f"subject is in the {risk_band} risk band")

    score = min(1.0, score)
    level = (
        "critical"
        if score >= 0.75
        else "high"
        if score >= 0.5
        else "medium"
        if score >= 0.25
        else "low"
    )

    ceiling_reason = NEVER_AUTOMATED.get(action)
    permitted = "four_eyes" if ceiling_reason else LEVEL_AUTONOMY[level]

    return Materiality(
        level=level,
        score=score,
        drivers=drivers,
        permitted_autonomy=permitted,
        ceiling_reason=ceiling_reason,
    )
