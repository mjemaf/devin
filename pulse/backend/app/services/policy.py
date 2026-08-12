"""Policy as code: versioned, effective-dated rule packs with a safe expression evaluator.

Rules live in YAML owned by the policy team, not in Python owned by engineering. Every evaluation
returns the full rule trace (which rules fired, which did not, and why) plus adverse-action reason
codes and counterfactuals, because "explain this decline" is a regulatory requirement under
ECOA/Reg B and the AOF's explainability process, not a nice-to-have.

The expression evaluator is an AST whitelist — no ``eval`` of policy text.
"""

from __future__ import annotations

import ast
import datetime as dt
import operator
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.config import get_settings

_COMPARATORS: dict[type[ast.cmpop], Any] = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}

# Policy authors write YAML, so YAML literals are accepted alongside their Python spellings.
_LITERALS: dict[str, Any] = {
    "true": True,
    "false": False,
    "null": None,
    "none": None,
}

# Ordered worst → best. The pack's own ``outcomes`` list must be a subset.
OUTCOME_SEVERITY: dict[str, int] = {
    "decline": 100,
    "terminate": 100,
    "hold_funds": 90,
    "refer": 70,
    "restrict": 60,
    "approve_with_conditions": 40,
    "watch": 30,
    "approve": 10,
    "no_action": 0,
}


class PolicyError(RuntimeError):
    pass


@dataclass(frozen=True)
class Rule:
    id: str
    description: str
    when: str
    outcome: str
    reason_code: str
    reason_text: str
    sop_ref: str | None = None
    conditions: tuple[str, ...] = ()
    escalate_to: str | None = None
    stop: bool = False


@dataclass(frozen=True)
class PolicyPack:
    pack: str
    version: str
    decision_type: str
    jurisdictions: tuple[str, ...]
    effective_from: dt.date
    owner: str | None
    outcomes: tuple[str, ...]
    rules: tuple[Rule, ...]
    # Set on a jurisdiction overlay: the base pack whose rules it adds to. Geographies are added by
    # dropping in an overlay pack, never by forking the base pack.
    overlay_of: str | None = None


@dataclass
class RuleResult:
    rule_id: str
    fired: bool
    outcome: str | None
    reason_code: str | None
    description: str
    sop_ref: str | None
    expression: str
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "fired": self.fired,
            "outcome": self.outcome,
            "reason_code": self.reason_code,
            "description": self.description,
            "sop_ref": self.sop_ref,
            "expression": self.expression,
            "error": self.error,
        }


@dataclass
class Evaluation:
    pack: str
    version: str
    decision_type: str
    outcome: str
    rule_results: list[RuleResult] = field(default_factory=list)
    reason_codes: list[dict[str, Any]] = field(default_factory=list)
    conditions: list[str] = field(default_factory=list)
    escalate_to: str | None = None
    counterfactuals: list[dict[str, Any]] = field(default_factory=list)
    features: dict[str, Any] = field(default_factory=dict)
    overlays: list[dict[str, str]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "pack": self.pack,
            "version": self.version,
            "overlays": self.overlays,
            "decision_type": self.decision_type,
            "outcome": self.outcome,
            "rule_results": [r.as_dict() for r in self.rule_results],
            "reason_codes": self.reason_codes,
            "conditions": self.conditions,
            "escalate_to": self.escalate_to,
            "counterfactuals": self.counterfactuals,
            "features": self.features,
        }


def _as_date(value: Any) -> dt.date:
    if isinstance(value, dt.date):
        return value
    return dt.date.fromisoformat(str(value))


def _load_pack(path: Path) -> PolicyPack:
    raw = yaml.safe_load(path.read_text())
    rules = tuple(
        Rule(
            id=item["id"],
            description=item.get("description", ""),
            when=item["when"],
            outcome=item["outcome"],
            reason_code=item["reason_code"],
            reason_text=item.get("reason_text", ""),
            sop_ref=item.get("sop_ref"),
            conditions=tuple(item.get("conditions") or ()),
            escalate_to=item.get("escalate_to"),
            stop=bool(item.get("stop", False)),
        )
        for item in raw["rules"]
    )
    return PolicyPack(
        pack=raw["pack"],
        version=str(raw["version"]),
        decision_type=raw["decision_type"],
        jurisdictions=tuple(raw.get("jurisdictions") or ("global",)),
        effective_from=_as_date(raw.get("effective_from", "1970-01-01")),
        owner=raw.get("owner"),
        outcomes=tuple(raw["outcomes"]),
        rules=rules,
        overlay_of=raw.get("overlay_of"),
    )


@lru_cache
def load_packs() -> dict[str, PolicyPack]:
    directory = get_settings().policy_dir
    packs: dict[str, PolicyPack] = {}
    for path in sorted(Path(directory).glob("*.yaml")):
        pack = _load_pack(path)
        packs[pack.pack] = pack
    if not packs:
        raise PolicyError(f"no policy packs found in {directory}")
    return packs


def get_pack(name: str, *, as_of: dt.date | None = None) -> PolicyPack:
    pack = load_packs().get(name)
    if pack is None:
        raise PolicyError(f"unknown policy pack {name}")
    as_of = as_of or dt.date.today()
    if pack.effective_from > as_of:
        raise PolicyError(f"pack {name} v{pack.version} is not effective until {pack.effective_from}")
    return pack


def overlays_for(base: str, jurisdiction: str, *, as_of: dt.date | None = None) -> list[PolicyPack]:
    """Overlay packs that apply to ``jurisdiction`` on top of ``base`` and are in force."""
    as_of = as_of or dt.date.today()
    return [
        pack
        for pack in load_packs().values()
        if pack.overlay_of == base
        and pack.effective_from <= as_of
        and jurisdiction.upper() in {j.upper() for j in pack.jurisdictions}
    ]


def _dotted(node: ast.AST) -> str | None:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def evaluate_expression(expression: str, facts: dict[str, Any]) -> bool:
    """Evaluate a policy predicate against a flat, dotted-key fact dict."""
    tree = ast.parse(expression, mode="eval").body

    def visit(node: ast.AST) -> Any:
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, (ast.Name, ast.Attribute)):
            key = _dotted(node)
            if key is None:
                raise PolicyError(f"unsupported reference in {expression!r}")
            if key in _LITERALS:
                return _LITERALS[key]
            if key not in facts:
                raise PolicyError(f"unknown fact {key!r}")
            return facts[key]
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            return [visit(element) for element in node.elts]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return not visit(node.operand)
        if isinstance(node, ast.BoolOp):
            values = [visit(value) for value in node.values]
            return all(values) if isinstance(node.op, ast.And) else any(values)
        if isinstance(node, ast.Compare):
            left = visit(node.left)
            for op, comparator in zip(node.ops, node.comparators, strict=True):
                fn = _COMPARATORS.get(type(op))
                if fn is None:
                    raise PolicyError(f"unsupported comparison in {expression!r}")
                right = visit(comparator)
                if not fn(left, right):
                    return False
                left = right
            return True
        raise PolicyError(f"unsupported expression element {type(node).__name__}")

    return bool(visit(tree))


def _counterfactuals(fired: list[Rule], facts: dict[str, Any]) -> list[dict[str, Any]]:
    """For each firing rule, the minimal fact change that would stop it firing.

    Derived by flipping/relaxing the referenced fact and re-evaluating, so the "what would have to
    change" statement is verified rather than asserted.
    """
    out: list[dict[str, Any]] = []
    for rule in fired:
        referenced = sorted({key for key in facts if key in rule.when})
        for key in referenced:
            probe = dict(facts)
            current = facts[key]
            if isinstance(current, bool):
                probe[key] = not current
            elif isinstance(current, (int, float)):
                probe[key] = 0
            elif current is None:
                continue
            else:
                probe[key] = "__none__"
            try:
                still_fires = evaluate_expression(rule.when, probe)
            except PolicyError:
                continue
            if not still_fires:
                out.append(
                    {
                        "rule_id": rule.id,
                        "reason_code": rule.reason_code,
                        "fact": key,
                        "observed": current,
                        "would_not_fire_if": probe[key],
                    }
                )
    return out


def evaluate(
    pack_name: str,
    facts: dict[str, Any],
    *,
    as_of: dt.date | None = None,
    jurisdiction: str = "global",
) -> Evaluation:
    """Evaluate the base pack plus any jurisdiction overlay in force, most severe outcome winning."""
    pack = get_pack(pack_name, as_of=as_of)
    if jurisdiction not in pack.jurisdictions and "global" not in pack.jurisdictions:
        raise PolicyError(f"pack {pack_name} does not cover jurisdiction {jurisdiction}")

    evaluation = _evaluate_pack(pack, facts)
    for overlay in overlays_for(pack.pack, jurisdiction, as_of=as_of):
        _merge(evaluation, _evaluate_pack(overlay, facts), overlay)
    return evaluation


def _merge(base: Evaluation, extra: Evaluation, overlay: PolicyPack) -> None:
    base.rule_results.extend(extra.rule_results)
    base.reason_codes.extend(extra.reason_codes)
    base.counterfactuals.extend(extra.counterfactuals)
    base.conditions = sorted(set(base.conditions) | set(extra.conditions))
    base.escalate_to = base.escalate_to or extra.escalate_to
    base.overlays.append({"pack": overlay.pack, "version": overlay.version})
    if OUTCOME_SEVERITY.get(extra.outcome, 0) > OUTCOME_SEVERITY.get(base.outcome, 0):
        base.outcome = extra.outcome


def _evaluate_pack(pack: PolicyPack, facts: dict[str, Any]) -> Evaluation:
    evaluation = Evaluation(
        pack=pack.pack,
        version=pack.version,
        decision_type=pack.decision_type,
        outcome=pack.outcomes[-1],
        features=dict(facts),
    )
    fired_rules: list[Rule] = []
    best_severity = -1

    for rule in pack.rules:
        try:
            fired = evaluate_expression(rule.when, facts)
            error = None
        except PolicyError as exc:
            # A missing fact is a control failure, not a pass: fail closed by referring.
            fired, error = False, str(exc)
        result = RuleResult(
            rule_id=rule.id,
            fired=fired,
            outcome=rule.outcome if fired else None,
            reason_code=rule.reason_code if fired else None,
            description=rule.description,
            sop_ref=rule.sop_ref,
            expression=rule.when,
            error=error,
        )
        evaluation.rule_results.append(result)
        if error is not None:
            evaluation.reason_codes.append(
                {
                    "code": "POLICY_INPUT_MISSING",
                    "text": f"Rule {rule.id} could not be evaluated: {error}",
                    "rule_id": rule.id,
                    "sop_ref": rule.sop_ref,
                }
            )
            fallback = "refer" if "refer" in pack.outcomes else "watch"
            if OUTCOME_SEVERITY[fallback] > best_severity:
                best_severity, evaluation.outcome = OUTCOME_SEVERITY[fallback], fallback
            continue
        if not fired:
            continue

        fired_rules.append(rule)
        evaluation.reason_codes.append(
            {
                "code": rule.reason_code,
                "text": rule.reason_text,
                "rule_id": rule.id,
                "sop_ref": rule.sop_ref,
            }
        )
        evaluation.conditions.extend(rule.conditions)
        evaluation.escalate_to = evaluation.escalate_to or rule.escalate_to
        severity = OUTCOME_SEVERITY.get(rule.outcome, 0)
        if severity > best_severity:
            best_severity, evaluation.outcome = severity, rule.outcome
        if rule.stop:
            break

    evaluation.conditions = sorted(set(evaluation.conditions))
    evaluation.counterfactuals = _counterfactuals(fired_rules, facts)
    return evaluation


def pack_summary() -> list[dict[str, Any]]:
    return [
        {
            "pack": pack.pack,
            "version": pack.version,
            "decision_type": pack.decision_type,
            "owner": pack.owner,
            "effective_from": pack.effective_from.isoformat(),
            "jurisdictions": list(pack.jurisdictions),
            "rule_count": len(pack.rules),
            "rules": [
                {
                    "id": rule.id,
                    "description": rule.description,
                    "outcome": rule.outcome,
                    "reason_code": rule.reason_code,
                    "sop_ref": rule.sop_ref,
                    "expression": rule.when,
                }
                for rule in pack.rules
            ],
        }
        for pack in load_packs().values()
    ]
