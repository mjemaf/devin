"""Company registry adapter (KYB): company record, officers, ownership."""

from __future__ import annotations

from typing import Any

from rapidfuzz import fuzz

from app.providers._fixtures import REGISTRY


def _key(params: dict[str, Any]) -> str | None:
    country = (params.get("country") or "").upper()
    number = (params.get("registration_number") or "").replace(" ", "").upper()
    key = f"{country}:{number}"
    return key if key in REGISTRY else None


def _by_name(name: str | None) -> str | None:
    if not name:
        return None
    best_key, best_score = None, 0.0
    for key, record in REGISTRY.items():
        score = fuzz.token_set_ratio(name.lower(), record["legal_name"].lower()) / 100
        if score > best_score:
            best_key, best_score = key, score
    return best_key if best_score >= 0.9 else None


def _resolve_key(params: dict[str, Any]) -> str | None:
    return _key(params) or _by_name(params.get("legal_name") or params.get("name"))


def lookup_company(params: dict[str, Any]) -> dict[str, Any]:
    key = _resolve_key(params)
    if key is None:
        return {"found": False, "query": params}
    record = REGISTRY[key]
    country, number = key.split(":", 1)
    return {
        "found": True,
        "country": country,
        "registration_number": number,
        "legal_name": record["legal_name"],
        "status": record["status"],
        "incorporated_on": record["incorporated_on"],
        "registered_address": record["registered_address"],
        "sic_codes": record["sic_codes"],
        # Jurisdiction-specific licence flags; absent means "not evidenced on the register".
        "fca_authorised": bool(record.get("fca_authorised", False)),
        "hmrc_msb_registered": bool(record.get("hmrc_msb_registered", False)),
    }


def lookup_officers(params: dict[str, Any]) -> dict[str, Any]:
    key = _resolve_key(params)
    if key is None:
        return {"found": False, "officers": []}
    return {"found": True, "officers": REGISTRY[key]["officers"]}


def lookup_ownership(params: dict[str, Any]) -> dict[str, Any]:
    key = _resolve_key(params)
    if key is None:
        return {"found": False, "ownership": []}
    return {"found": True, "ownership": REGISTRY[key]["ownership"]}
