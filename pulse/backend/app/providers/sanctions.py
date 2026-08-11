"""Sanctions / PEP / watchlist adapter.

Matching itself lives in :mod:`app.services.screening`; the adapter only supplies list data, which
is how a list-provider swap stays a configuration change.
"""

from __future__ import annotations

from typing import Any

from app.providers._fixtures import SANCTIONS_LIST


def screen(params: dict[str, Any]) -> dict[str, Any]:
    lists = params.get("lists") or ["sanctions", "pep", "internal_watchlist", "negative_file"]
    entries = [entry for entry in SANCTIONS_LIST if entry["list_type"] in lists]
    return {"entries": entries, "lists": lists}
