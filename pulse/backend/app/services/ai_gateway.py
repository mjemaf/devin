"""PLS-80 AI model gateway and PLS-83 cost management.

Every inference in the platform leaves through here, which is what makes the following enforceable
in code rather than in a policy document:

* the artefact is registered and validated for this purpose (PLS-71);
* the caller is entitled to the data classification being sent, and residency is honoured;
* spend is attributed to a use case and refused when the budget is exhausted;
* the invocation is logged with the context manifest hash, so an answer can be tied to the exact
  bounded context it was given.

The default provider is deterministic and local (``llm_provider="local"``): grounding is enforced
structurally by the caller, so no key, network egress or third-party processor is required to
demonstrate the control surface. A hosted provider is a new branch in :func:`_invoke`, not a new
control path.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ModelInvocation
from app.services import entitlements, model_registry

# Indicative unit prices per 1k tokens, held here so cost attribution is exercised end to end.
UNIT_COST_PER_1K: dict[str, float] = {"local": 0.0, "hosted-small": 0.0006, "hosted-large": 0.009}


class GatewayError(RuntimeError):
    """A refused inference: unregistered artefact, entitlement, residency or budget failure."""


@dataclass
class Invocation:
    artefact_key: str
    artefact_version: str
    purpose: str
    output: str
    citations: list[dict[str, Any]] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    cost: float = 0.0
    latency_ms: int = 0
    provider: str = "local"
    degraded: bool = False
    detail: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "artefact": f"{self.artefact_key} v{self.artefact_version}",
            "purpose": self.purpose,
            "provider": self.provider,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "cost": round(self.cost, 6),
            "latency_ms": self.latency_ms,
            "degraded": self.degraded,
            "detail": self.detail,
        }


def manifest_hash(context: dict[str, Any]) -> str:
    material = repr(sorted((str(k), str(v)) for k, v in context.items()))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _tokens(text: str) -> int:
    # Deterministic and provider-agnostic: whitespace tokens are enough to exercise metering.
    return max(1, len(text.split()))


def spend_by_use_case(session: Session) -> dict[str, float]:
    rows = session.execute(
        select(ModelInvocation.use_case, func.sum(ModelInvocation.cost)).group_by(
            ModelInvocation.use_case
        )
    ).all()
    return {str(use_case): float(cost or 0.0) for use_case, cost in rows}


def budget_state(session: Session) -> dict[str, Any]:
    settings = get_settings()
    spent = spend_by_use_case(session)
    budgets = settings.ai_use_case_budgets
    return {
        "period_budget": settings.ai_period_budget,
        "period_spend": round(sum(spent.values()), 6),
        "by_use_case": {
            use_case: {
                "spend": round(value, 6),
                "budget": budgets.get(use_case),
                "exhausted": bool(
                    budgets.get(use_case) is not None and value >= float(budgets[use_case])
                ),
            }
            for use_case, value in sorted(spent.items())
        },
        "unit_cost_per_1k": UNIT_COST_PER_1K,
    }


def _check_budget(session: Session, use_case: str) -> None:
    settings = get_settings()
    spent = spend_by_use_case(session)
    total = sum(spent.values())
    if settings.ai_period_budget is not None and total >= settings.ai_period_budget:
        raise GatewayError(
            f"period AI budget of {settings.ai_period_budget} exhausted; inference refused"
        )
    limit = settings.ai_use_case_budgets.get(use_case)
    if limit is not None and spent.get(use_case, 0.0) >= float(limit):
        raise GatewayError(f"AI budget for use case '{use_case}' exhausted; inference refused")


def invoke(
    session: Session,
    *,
    artefact_key: str,
    purpose: str,
    caller: entitlements.Caller,
    context: dict[str, Any],
    passages: list[dict[str, Any]] | None = None,
    use_case: str = "unassigned",
    arp_key: str | None = None,
    prompt_version: str = "v1",
    entity_id: int | None = None,
    classification: str = "internal",
    region: str = "global",
    provider: str | None = None,
) -> Invocation:
    """Run a registered artefact against a bounded context, or refuse and say why."""
    settings = get_settings()
    resolved_provider = provider or settings.llm_provider
    artefact = model_registry.require_runnable(session, artefact_key, purpose=purpose)

    if not entitlements.permits_classification(caller, classification):
        raise GatewayError(
            f"{caller.actor} may not send '{classification}' data to a model"
        )
    if not entitlements.permits_region(caller, region):
        raise GatewayError(f"{caller.actor} is not entitled to region '{region}'")
    if artefact.residency != "global" and artefact.residency != region:
        raise GatewayError(
            f"artefact '{artefact_key}' is resident in {artefact.residency} and may not process "
            f"{region} data"
        )
    if classification in (artefact.barred_classifications or []):
        raise GatewayError(
            f"artefact '{artefact_key}' may not process '{classification}' data"
        )
    _check_budget(session, use_case)

    started = time.perf_counter()
    output, degraded, detail = _invoke(resolved_provider, context, passages or [])
    latency_ms = int((time.perf_counter() - started) * 1000)

    tokens_in = _tokens(repr(context)) + sum(_tokens(str(p.get("text", ""))) for p in passages or [])
    tokens_out = _tokens(output)
    unit = UNIT_COST_PER_1K.get(resolved_provider, 0.0)
    cost = round((tokens_in + tokens_out) / 1000.0 * unit, 6)

    session.add(
        ModelInvocation(
            artefact_key=artefact.key,
            artefact_version=artefact.version,
            purpose=purpose,
            caller=caller.actor,
            arp_key=arp_key,
            use_case=use_case,
            prompt_version=prompt_version,
            entity_id=entity_id,
            context_manifest_hash=manifest_hash(context),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost=cost,
            latency_ms=latency_ms,
            outcome="degraded" if degraded else "ok",
            detail=detail,
        )
    )
    session.flush()
    return Invocation(
        artefact_key=artefact.key,
        artefact_version=artefact.version,
        purpose=purpose,
        output=output,
        citations=[
            {key: passage[key] for key in ("document_key", "version", "chunk_id") if key in passage}
            for passage in passages or []
        ],
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost=cost,
        latency_ms=latency_ms,
        provider=resolved_provider,
        degraded=degraded,
        detail=detail,
    )


def _invoke(
    provider: str, context: dict[str, Any], passages: list[dict[str, Any]]
) -> tuple[str, bool, str | None]:
    """The provider boundary. ``local`` composes extractively from the supplied passages only."""
    if provider != "local":
        # No hosted provider is configured in the reference build: fail visibly rather than
        # silently falling back to something ungoverned.
        raise GatewayError(f"provider '{provider}' is not configured in this deployment")
    if not passages:
        return ("", True, "no passages supplied; nothing may be asserted")
    body = " ".join(str(passage.get("text", "")).strip() for passage in passages if passage.get("text"))
    return (body.strip(), False, None)


def invocation_log(session: Session, *, limit: int = 100) -> list[dict[str, Any]]:
    rows = session.execute(
        select(ModelInvocation).order_by(ModelInvocation.id.desc()).limit(limit)
    ).scalars().all()
    return [
        {
            "artefact": f"{row.artefact_key} v{row.artefact_version}",
            "purpose": row.purpose,
            "caller": row.caller,
            "arp_key": row.arp_key,
            "use_case": row.use_case,
            "prompt_version": row.prompt_version,
            "entity_id": row.entity_id,
            "context_manifest_hash": row.context_manifest_hash,
            "tokens_in": row.tokens_in,
            "tokens_out": row.tokens_out,
            "cost": row.cost,
            "latency_ms": row.latency_ms,
            "outcome": row.outcome,
            "detail": row.detail,
            "created_at": row.created_at,
        }
        for row in rows
    ]
