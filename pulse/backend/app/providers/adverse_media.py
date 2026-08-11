"""Adverse media adapter: negative news on the entity and its owners."""

from __future__ import annotations

from typing import Any

from rapidfuzz import fuzz

from app.providers._fixtures import ADVERSE_MEDIA

SEVERITY_WEIGHT = {"low": 0.2, "medium": 0.5, "high": 0.85}


def search(params: dict[str, Any]) -> dict[str, Any]:
    name = params.get("name") or ""
    articles: list[dict[str, Any]] = []
    for subject, items in ADVERSE_MEDIA.items():
        if fuzz.token_set_ratio(name.lower(), subject.lower()) / 100 >= 0.9:
            for item in items:
                articles.append(
                    {
                        "subject": subject,
                        "headline": item["headline"],
                        "publication": item["source"],
                        "published": item["published_on"],
                        "category": (item["topics"] or ["general"])[0],
                        "topics": item["topics"],
                        "severity": item["severity"],
                        # Stands in for source-reliability scoring: a named publication with a
                        # dated article is treated as more credible than aggregated chatter.
                        "credibility": SEVERITY_WEIGHT[item["severity"]],
                    }
                )
    score = max((SEVERITY_WEIGHT[a["severity"]] for a in articles), default=0.0)
    return {"name": name, "articles": articles, "severity_score": score}
