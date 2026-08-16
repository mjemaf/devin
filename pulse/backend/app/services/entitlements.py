"""PLS-75 entitlements, access and segregation of duties.

The rule the architecture is emphatic about: an agent's data scope is the **intersection** of its
pathway scope and the entitlements of the human or service invoking it, never the union. A pathway
declaring ``facts.*`` invoked by a first-line analyst who cannot see credit data does not get credit
data.

Segregation of duties is expressed here too: the same identity cannot occupy two roles in one
decision (propose and approve), and some roles simply cannot approve some decision classes.
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from typing import Any

# role -> data scopes it may read
ROLE_SCOPES: dict[str, tuple[str, ...]] = {
    "analyst": (
        "entity.*",
        "merchant.*",
        "facts.registry.*",
        "facts.application.*",
        "screening.hits",
        "graph.*",
        "alerts.*",
        "cases.*",
        "scores.*",
        "knowledge.*",
        "documents.*",
        "evidence.*",
    ),
    "senior_analyst": (
        "entity.*",
        "merchant.*",
        "facts.*",
        "screening.hits",
        "graph.*",
        "alerts.*",
        "cases.*",
        "scores.*",
        "knowledge.*",
        "documents.*",
        "evidence.*",
        "credit.summary",
    ),
    "credit_officer": (
        "entity.*",
        "merchant.*",
        "facts.*",
        "credit.*",
        "scores.*",
        "cases.*",
        "knowledge.*",
    ),
    "risk_owner": ("*",),
    "second_line": ("*",),
    "auditor": ("*",),
    "system": ("*",),
    "service": ("entity.*", "merchant.*", "facts.registry.*", "scores.*", "knowledge.*"),
}

# Decision classes each role may approve. Second line and the risk owner are the approvers of
# record; first-line analysts may never approve their own class of work.
APPROVAL_RIGHTS: dict[str, tuple[str, ...]] = {
    "senior_analyst": ("screening_disposition", "monitoring_action", "requirement_waiver"),
    "credit_officer": ("credit_decision", "reserve_change"),
    "risk_owner": ("*",),
    "second_line": ("*",),
}

# Roles that may never approve, whatever the decision class.
NON_APPROVING_ROLES: frozenset[str] = frozenset({"analyst", "auditor", "system", "service", "agent"})

CLASSIFICATION_RANK: dict[str, int] = {"public": 0, "internal": 1, "confidential": 2, "restricted": 3}


class EntitlementError(PermissionError):
    """A read or approval that the caller's entitlements do not permit."""


@dataclass
class Caller:
    """Who is asking. Agents always carry the invoking human or service context with them."""

    actor: str
    role: str = "analyst"
    regions: tuple[str, ...] = ("global",)
    max_classification: str = "confidential"
    on_behalf_of: str | None = None
    extra_scopes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def scopes(self) -> tuple[str, ...]:
        return tuple(ROLE_SCOPES.get(self.role, ())) + self.extra_scopes

    def as_dict(self) -> dict[str, Any]:
        return {
            "actor": self.actor,
            "role": self.role,
            "regions": list(self.regions),
            "max_classification": self.max_classification,
            "on_behalf_of": self.on_behalf_of,
            "scopes": list(self.scopes),
        }


def matches(scope: str, pattern: str) -> bool:
    """Scope matching is symmetric so ``facts.*`` and ``facts.registry.status`` satisfy each other."""
    return fnmatch.fnmatch(scope, pattern) or fnmatch.fnmatch(pattern, scope)


def permits(caller: Caller, scope: str) -> bool:
    return any(matches(scope, pattern) for pattern in caller.scopes)


def intersect(caller: Caller, declared_scopes: list[str] | tuple[str, ...]) -> list[str]:
    """The effective data scope: declared pathway scope ∩ caller entitlements."""
    return [scope for scope in declared_scopes if permits(caller, scope)]


def require(caller: Caller, scope: str) -> None:
    if not permits(caller, scope):
        raise EntitlementError(f"{caller.actor} ({caller.role}) is not entitled to '{scope}'")


def permits_classification(caller: Caller, classification: str) -> bool:
    return CLASSIFICATION_RANK.get(classification, 3) <= CLASSIFICATION_RANK.get(
        caller.max_classification, 1
    )


def permits_region(caller: Caller, region: str) -> bool:
    return "global" in caller.regions or region in caller.regions


def may_approve(role: str, decision_class: str) -> bool:
    if role in NON_APPROVING_ROLES:
        return False
    rights = APPROVAL_RIGHTS.get(role, ())
    return "*" in rights or decision_class in rights


def check_segregation(*, proposer: str, approver: str, requester: str | None = None) -> None:
    """No identity may occupy two roles in the same decision (C6)."""
    if approver == proposer:
        raise EntitlementError("the approver may not be the proposer (four-eyes)")
    if requester is not None and approver == requester:
        raise EntitlementError("the approver may not be the requester (four-eyes)")


def matrix() -> dict[str, Any]:
    return {
        "role_scopes": {role: list(scopes) for role, scopes in ROLE_SCOPES.items()},
        "approval_rights": {role: list(rights) for role, rights in APPROVAL_RIGHTS.items()},
        "non_approving_roles": sorted(NON_APPROVING_ROLES),
        "classifications": CLASSIFICATION_RANK,
        "rule": "effective agent scope = ARP data scope ∩ caller entitlements (never the union)",
    }
