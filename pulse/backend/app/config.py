from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    """Platform configuration. Everything that differs per environment lives here."""

    model_config = SettingsConfigDict(env_prefix="PULSE_", env_file=".env", extra="ignore")

    database_url: str = f"sqlite:///{BACKEND_DIR / 'pulse.db'}"

    # Inference provider. "local" is a deterministic extractive composer that requires no keys;
    # grounding is enforced structurally rather than by prompt instruction.
    llm_provider: str = "local"

    # Retrieval / grounding
    retrieval_top_k: int = 5
    # Share of a question's information content that the best-matching chunk must cover before the
    # platform is willing to answer. Questions the corpus genuinely covers score 0.5-0.95; ones it
    # only shares vocabulary with (crypto custody licensing) sit near 0.2, and must be refused.
    grounding_threshold: float = 0.35

    # Entity resolution confidence bands
    resolution_auto_merge: float = 0.92
    resolution_review_floor: float = 0.75

    # Screening match thresholds
    screening_hit_threshold: float = 0.82
    screening_strong_match: float = 0.93

    # Materiality: exposure above which a machine may never act alone (minor units of account)
    materiality_exposure_ceiling: float = 250_000.0

    # Autonomy graduation gates (see docs/GOVERNANCE.md)
    shadow_min_cases: int = 500
    suggest_min_agreement: float = 0.95
    four_eyes_min_agreement: float = 0.97

    # Third-party gateway
    gateway_cache_ttl_seconds: int = 86_400

    # Seeds the synthetic portfolio on first start so a fresh clone has something to look at.
    seed_on_startup: bool = True

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    data_dir: Path = REPO_DIR / "data"
    policy_dir: Path = BACKEND_DIR / "app" / "policies"
    residency_region: str = "global"


@lru_cache
def get_settings() -> Settings:
    return Settings()
