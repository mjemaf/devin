"""Caller identity, verified server-side.

Every governance control downstream of the API boundary — segregation of duties (PLS-75),
four-eyes approval, the action broker, agent oversight — is identity- and role-based: it decides
what a caller may do by trusting an ``actor`` and a ``role``. Those fields must therefore come
from something the caller cannot forge. This module is that source: it resolves a bearer
credential to a :class:`Principal` from a server-side directory, so a request can no longer
simply *assert* ``role: "risk_owner"`` in its JSON body to approve its own action.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, HTTPException

from app.config import get_settings


@dataclass(frozen=True)
class Principal:
    """The authenticated caller: who they are and what role they were issued."""

    actor: str
    role: str


def _directory() -> dict[str, Principal]:
    directory: dict[str, Principal] = {}
    for token, identity in get_settings().api_credentials.items():
        actor, _, role = identity.partition("|")
        directory[token] = Principal(actor=actor, role=role or "analyst")
    return directory


def require_principal(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> Principal:
    """FastAPI dependency: resolve and return the caller's verified identity, or refuse."""
    if not x_api_key:
        raise HTTPException(status_code=401, detail="missing X-API-Key credential")
    principal = _directory().get(x_api_key)
    if principal is None:
        raise HTTPException(status_code=401, detail="invalid credential")
    return principal
