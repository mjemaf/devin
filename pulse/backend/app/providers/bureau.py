"""Credit bureau adapter — the most expensive call in the platform, hence tiered and cached."""

from __future__ import annotations

from typing import Any

from app.providers._fixtures import CREDIT_FILES


def credit_file(params: dict[str, Any]) -> dict[str, Any]:
    country = (params.get("country") or "").upper()
    number = (params.get("registration_number") or "").replace(" ", "").upper()
    record = CREDIT_FILES.get(f"{country}:{number}")
    if record is None:
        return {"found": False, "thin_file": True}
    return {"found": True, "thin_file": record["filed_turnover"] == 0, **record}
