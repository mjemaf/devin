"""Seed a synthetic but realistic portfolio, so every capability is demonstrable on a fresh clone.

The portfolio is not a happy path. It contains, deliberately:

* a dissolved company previously off-boarded for cause (Meridian Wellness), and its director on the
  internal negative file;
* a new applicant (Halcyon Wellness) owned through a holding company that shares that director and
  that registered address — the reincarnation pattern periodic reviews miss;
* a name-only near match to a sanctions entry that must be demoted on date of birth;
* a PEP beneficial owner, a registry/application mismatch, adverse media, a thin credit file, a
  vape merchant that a later policy version prohibits, and merchants that drift after boarding.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import create_all, session_scope
from app.models import Document, Entity, Merchant, utcnow
from app.services import (
    arp_registry,
    audit,
    decisioning,
    evaluation,
    events,
    knowledge,
    kyb,
    model_registry,
    monitoring,
    provenance,
    resolution,
    transactions,
)

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "knowledge"

KNOWLEDGE: list[dict[str, Any]] = [
    {
        "key": "POL-KYB-002",
        "title": "Know Your Business and Entity Verification Standard",
        "doc_type": "policy",
        "file": "POL-KYB-002.md",
        "owner": "financial-crime-policy",
        "effective_from": dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
    },
    {
        "key": "POL-SANC-001",
        "title": "Sanctions and Watchlist Screening Policy",
        "doc_type": "policy",
        "file": "POL-SANC-001.md",
        "owner": "sanctions-officer",
        "effective_from": dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
    },
    {
        "key": "POL-CB-001",
        "title": "Chargeback and Dispute Risk Management Policy",
        "doc_type": "policy",
        "file": "POL-CB-001.md",
        "owner": "risk-operations",
        "effective_from": dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
    },
    {
        "key": "POL-AOF-001",
        "title": "Agentic Automation Oversight Standard",
        "doc_type": "policy",
        "file": "POL-AOF-001.md",
        "owner": "model-risk",
        "effective_from": dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
    },
    {
        "key": "POL-CRD-002",
        "title": "Merchant Credit Risk and Exposure Policy",
        "doc_type": "policy",
        "file": "POL-CRD-002.md",
        "owner": "credit-risk",
        "effective_from": dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
    },
    {
        "key": "POL-MON-003",
        "title": "Perpetual Monitoring and Periodic Review Standard",
        "doc_type": "policy",
        "file": "POL-MON-003.md",
        "owner": "risk-operations",
        "effective_from": dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
    },
    # Two versions of the same policy: vaping moves from restricted to prohibited. This is what
    # makes "what did the rule say in February?" answerable.
    {
        "key": "POL-ACC-001",
        "title": "Acceptable Use and Prohibited Business Policy",
        "doc_type": "policy",
        "file": "POL-ACC-001-v1.md",
        "owner": "financial-crime-policy",
        "effective_from": dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
    },
    {
        "key": "POL-ACC-001",
        "title": "Acceptable Use and Prohibited Business Policy",
        "doc_type": "policy",
        "file": "POL-ACC-001-v2.md",
        "owner": "financial-crime-policy",
        "effective_from": dt.datetime(2026, 7, 1, tzinfo=dt.timezone.utc),
    },
]

# Existing book: boarded before today, with post-boarding performance.
PORTFOLIO: list[dict[str, Any]] = [
    {
        "application_id": "APP-1001",
        "legal_name": "Northwind Retail Limited",
        "trading_name": "Northwind",
        "country": "GB",
        "registration_number": "09112233",
        "website": "https://northwind-retail.co.uk",
        "address": "18 Kingsway, London, WC2B 6UN, GB",
        "email": "finance@northwind-retail.co.uk",
        "director_name": "Sarah Whitfield",
        "mcc": "5691",
        "business_model": "ecommerce_retail",
        "segment": "mid",
        "region": "UK",
        "expected_monthly_volume": 350_000.0,
        "post_boarding": {"monthly_volume": 380_000.0, "chargeback_rate": 0.0021},
        "boarded_days_ago": 900,
        "reviewed_days_ago": 120,
    },
    {
        "application_id": "APP-1002",
        "legal_name": "Aurora Digital Goods GmbH",
        "country": "DE",
        "registration_number": "HRB88123",
        "website": "https://aurora-digital.de",
        "address": "Friedrichstrasse 90, 10117 Berlin, DE",
        "email": "risk@aurora-digital.de",
        "director_name": "Jonas Brenner",
        "mcc": "5815",
        "business_model": "digital_subscriptions",
        "segment": "mid",
        "region": "EU",
        "expected_monthly_volume": 620_000.0,
        "post_boarding": {"monthly_volume": 705_000.0, "chargeback_rate": 0.0074},
        "boarded_days_ago": 500,
        "reviewed_days_ago": 200,
    },
    {
        "application_id": "APP-1003",
        "legal_name": "Pinnacle Travel Services Ltd",
        "country": "GB",
        "registration_number": "07445566",
        "website": "https://pinnacletravel.co.uk",
        "address": "5 Ocean View, Southampton, SO14 3JL, GB",
        "email": "ops@pinnacletravel.co.uk",
        "director_name": "Daniel Osei",
        "mcc": "4722",
        "business_model": "travel_agency",
        "segment": "mid",
        "region": "UK",
        "expected_monthly_volume": 900_000.0,
        # Long delivery windows plus a weak bureau file: the credit exposure case.
        "post_boarding": {"monthly_volume": 1_250_000.0, "chargeback_rate": 0.0112},
        "boarded_days_ago": 1200,
        "reviewed_days_ago": 400,
    },
    {
        "application_id": "APP-1004",
        "legal_name": "Helios Nutra Ltd",
        "trading_name": "Helios Supplements",
        "country": "GB",
        "registration_number": "11223344",
        "website": "https://helios-nutra.com",
        "address": "44 Mill Lane, Manchester, M4 1LE, GB",
        "email": "billing@helios-nutra.com",
        "director_name": "Priya Raman",
        "mcc": "5122",
        "business_model": "supplements_subscription",
        "segment": "smb",
        "region": "UK",
        "expected_monthly_volume": 180_000.0,
        "post_boarding": {"monthly_volume": 240_000.0, "chargeback_rate": 0.0088},
        "boarded_days_ago": 420,
        "reviewed_days_ago": 380,
    },
    {
        "application_id": "APP-1005",
        "legal_name": "Zenith Freight B.V.",
        "country": "NL",
        "registration_number": "34567890",
        "website": "https://zenithfreight.nl",
        "address": "Havenstraat 12, 3013 AL Rotterdam, NL",
        "email": "admin@zenithfreight.nl",
        "director_name": "Willem de Vries",
        "mcc": "4214",
        "business_model": "b2b_logistics",
        "segment": "enterprise",
        "region": "EU",
        "expected_monthly_volume": 1_400_000.0,
        "post_boarding": {"monthly_volume": 1_380_000.0, "chargeback_rate": 0.0004},
        "boarded_days_ago": 1500,
        "reviewed_days_ago": 90,
    },
    {
        "application_id": "APP-1006",
        "legal_name": "Vertex Digital Exchange Ltd",
        "country": "GB",
        "registration_number": "12987654",
        "website": "https://vertex-exchange.io",
        "address": "1 Threadneedle Walk, London, EC2R 8AH, GB",
        "email": "compliance@vertex-exchange.io",
        "director_name": "Elena Vasquez",
        "mcc": "6051",
        "business_model": "crypto_exchange",
        "segment": "mid",
        "region": "UK",
        "expected_monthly_volume": 2_100_000.0,
        "post_boarding": {"monthly_volume": 2_600_000.0, "chargeback_rate": 0.0031},
        "boarded_days_ago": 300,
        "reviewed_days_ago": 300,
    },
    {
        "application_id": "APP-1007",
        "legal_name": "Solent Marketplace Ltd",
        "country": "GB",
        "registration_number": "10555777",
        "website": "https://solentmarket.co.uk",
        "address": "22 Dock Road, Portsmouth, PO1 3TY, GB",
        "email": "hello@solentmarket.co.uk",
        "director_name": "Aisha Bello",
        "mcc": "5399",
        "business_model": "marketplace",
        "segment": "smb",
        "region": "UK",
        "expected_monthly_volume": 260_000.0,
        "post_boarding": {"monthly_volume": 290_000.0, "chargeback_rate": 0.0015},
        "boarded_days_ago": 700,
        "reviewed_days_ago": 150,
    },
    {
        "application_id": "APP-1008",
        "legal_name": "Orion Vape Supplies Ltd",
        "country": "GB",
        "registration_number": "09877665",
        "website": "https://orionvape.co.uk",
        "address": "77 Barrow Street, Bristol, BS1 6QT, GB",
        "email": "accounts@orionvape.co.uk",
        "director_name": "Karl Jensen",
        "mcc": "5993",
        "business_model": "vape_retail",
        "segment": "smb",
        "region": "UK",
        "expected_monthly_volume": 140_000.0,
        "post_boarding": {"monthly_volume": 160_000.0, "chargeback_rate": 0.0062},
        "boarded_days_ago": 800,
        "reviewed_days_ago": 500,
    },
    {
        "application_id": "APP-1009",
        "legal_name": "Lumina Ads Ltd",
        "country": "GB",
        "registration_number": "12446688",
        "website": "https://luminaads.co.uk",
        "address": "9 Peel Street, Birmingham, B1 2HN, GB",
        "email": "finance@luminaads.co.uk",
        "director_name": "Marcos Feldmann",
        "mcc": "7311",
        "business_model": "advertising_services",
        "segment": "smb",
        "region": "UK",
        "expected_monthly_volume": 95_000.0,
        "post_boarding": {"monthly_volume": 110_000.0, "chargeback_rate": 0.0023},
        "boarded_days_ago": 260,
        "reviewed_days_ago": 100,
    },
    {
        "application_id": "APP-1010",
        "legal_name": "Cedar Point Payments Inc",
        "country": "US",
        "registration_number": "5512399",
        "website": "https://cedarpointpay.com",
        "address": "400 Lakeside Dr, Cleveland, OH 44113, US",
        "email": "risk@cedarpointpay.com",
        "director_name": "Robert Lang",
        "mcc": "7372",
        "business_model": "software_platform",
        "segment": "enterprise",
        "region": "US",
        "expected_monthly_volume": 1_800_000.0,
        "post_boarding": {"monthly_volume": 1_750_000.0, "chargeback_rate": 0.0009},
        "boarded_days_ago": 1100,
        "reviewed_days_ago": 60,
    },
]

# The live application that ties the ring together. Note the applicant claims a director the
# register disagrees with, and understates nothing else — the risk is entirely in the network.
HALCYON_APPLICATION: dict[str, Any] = {
    "application_id": "APP-2001",
    "legal_name": "Halcyon Wellness Ltd",
    "trading_name": "Halcyon Wellness",
    "country": "GB",
    "registration_number": "14778899",
    "website": "https://halcyon-wellness.co.uk",
    "address": "3 Fenwick Court, Leeds, LS1 5AB, GB",
    "email": "director@halcyon-wellness.co.uk",
    "director_name": "Michael Feldon",
    "mcc": "5122",
    "business_model": "supplements_subscription",
    "segment": "smb",
    "region": "UK",
    "expected_monthly_volume": 120_000.0,
}


def seed_knowledge(session: Session) -> int:
    for spec in KNOWLEDGE:
        text = (DATA_DIR / spec["file"]).read_text(encoding="utf-8")
        knowledge.ingest_document(
            session,
            key=spec["key"],
            title=spec["title"],
            doc_type=spec["doc_type"],
            text=text,
            owner=spec["owner"],
            effective_from=spec["effective_from"],
            approve=True,
            actor=spec["owner"],
        )
    return len(session.execute(select(Document)).scalars().all())


def seed_offboarded_history(session: Session) -> int:
    """Meridian Wellness: dissolved, terminated for cause in 2025, director on the negative file.

    Seeded as history rather than boarded through the decision path, because it is exactly the kind
    of record a real platform inherits from a legacy system.
    """
    resolved = resolution.resolve(
        session,
        source_system="legacy_boarding",
        source_ref="MID-778812",
        payload={
            "legal_name": "Meridian Wellness Ltd",
            "country": "GB",
            "registration_number": "08991122",
            "address": "3 Fenwick Court, Leeds, LS1 5AB, GB",
            "entity_type": "company",
        },
        actor="migration",
    )
    kyb.verify(session, resolved.entity_id, actor="migration")
    entity = session.get(Entity, resolved.entity_id)
    assert entity is not None
    entity.status = "offboarded"
    entity.offboarded_reason = "Terminated for cause 2025-08 — excessive chargebacks (2.4%)"

    merchant = Merchant(
        entity_id=entity.id,
        display_name="Meridian Wellness",
        segment="smb",
        region="UK",
        mcc="5122",
        underwritten_mcc="5122",
        business_model="supplements_subscription",
        underwritten_business_model="supplements_subscription",
        lifecycle_state="terminated",
        monthly_volume=0.0,
        declared_volume=140_000.0,
        chargeback_rate=0.024,
        credit_limit=150_000.0,
        boarded_at=utcnow() - dt.timedelta(days=1800),
        terminated_at=utcnow() - dt.timedelta(days=360),
        last_reviewed_at=utcnow() - dt.timedelta(days=400),
    )
    session.add(merchant)
    session.flush()
    audit.append(
        session,
        actor="migration",
        action="entity.offboarded_history_loaded",
        subject_id=entity.id,
        payload={
            "entity_id": entity.id,
            "reason": entity.offboarded_reason,
            "terminated_at": merchant.terminated_at,
            "chargeback_rate_at_termination": merchant.chargeback_rate,
        },
    )
    return entity.id


def seed_portfolio(session: Session) -> list[dict[str, Any]]:
    outcomes: list[dict[str, Any]] = []
    for application in PORTFOLIO:
        post = application.get("post_boarding", {})
        result = decisioning.board(session, application, actor="seed.underwriter")
        merchant = session.get(Merchant, result["merchant_id"])
        assert merchant is not None
        # Backdate boarding and apply observed trading, so monitoring has something to find.
        if merchant.lifecycle_state in {"boarded", "active"}:
            merchant.lifecycle_state = "active"
            merchant.boarded_at = utcnow() - dt.timedelta(days=application["boarded_days_ago"])
            merchant.last_reviewed_at = utcnow() - dt.timedelta(
                days=application["reviewed_days_ago"]
            )
            merchant.review_cadence_days = 365
        merchant.monthly_volume = float(post.get("monthly_volume") or 0.0)
        merchant.declared_volume = float(application.get("expected_monthly_volume") or 0.0)
        merchant.chargeback_rate = float(post.get("chargeback_rate") or 0.0)
        merchant.platform_mid = f"MID{merchant.id:06d}"
        session.flush()
        outcomes.append(
            {
                "application_id": application["application_id"],
                "legal_name": application["legal_name"],
                "entity_id": result["entity_id"],
                "outcome": result["outcome"],
                "reason_codes": [reason["code"] for reason in result["reason_codes"]],
                "risk_score": result["score"]["value"],
                "risk_band": result["score"]["band"],
                "case_id": result["case_id"],
            }
        )
    return outcomes


def seed_drift_signals(session: Session) -> None:
    """Post-boarding reality: two merchants drift from what was underwritten."""
    def merchant_by_name(name: str) -> Merchant | None:
        return session.execute(
            select(Merchant).where(Merchant.display_name == name)
        ).scalars().first()

    helios = merchant_by_name("Helios Supplements")
    if helios is not None:
        events.publish(
            session,
            events.Event(
                name=events.TRANSACTION_SIGNAL,
                subject_type="merchant",
                subject_id=helios.id,
                payload={
                    "merchant_id": helios.id,
                    "business_model": "nutraceutical_free_trial",
                    "chargeback_rate": 0.0131,
                    "monthly_volume": 265_000.0,
                    "observation": "Free-trial funnel introduced; dispute reasons shifted to"
                    " subscription cancellation.",
                },
            ),
        )

    pinnacle = merchant_by_name("Pinnacle Travel Services Ltd")
    if pinnacle is not None:
        events.publish(
            session,
            events.Event(
                name=events.TRANSACTION_SIGNAL,
                subject_type="merchant",
                subject_id=pinnacle.id,
                payload={
                    "merchant_id": pinnacle.id,
                    "monthly_volume": 3_100_000.0,
                    "chargeback_rate": 0.0121,
                    "observation": "Volume 3.4x underwritten with lengthening delivery lag.",
                },
            ),
        )


# Authorisations per active merchant, with one deliberate cross-platform duplicate, so the
# deduplication and aggregation in PLS-16 are exercised rather than merely described.
TRANSACTION_COUNTRIES = ("GB", "DE", "NL", "FR", "US")


def seed_transaction_stream(session: Session) -> dict[str, Any]:
    merchants = session.execute(
        select(Merchant).where(Merchant.lifecycle_state == "active")
    ).scalars().all()
    batch: list[dict[str, Any]] = []
    for index, merchant in enumerate(merchants):
        if merchant.platform_mid is None:
            continue
        daily = max(merchant.monthly_volume / 30.0, 100.0)
        for day in range(6):
            occurred = utcnow() - dt.timedelta(days=day, hours=index)
            country = TRANSACTION_COUNTRIES[(index + day) % len(TRANSACTION_COUNTRIES)]
            batch.append(
                {
                    "auth_id": f"AUTH-{merchant.id}-{day}",
                    "mid": merchant.platform_mid,
                    "amount": round(daily / 4.0, 2),
                    "currency": "EUR" if merchant.region == "EU" else "GBP",
                    "auth_time": occurred.isoformat(),
                    "entry_mode": "ecommerce",
                    "issuer_country": country,
                    "mcc": merchant.mcc,
                }
            )
        # The same authorisation re-reported: it must not double the merchant's exposure.
        batch.append(
            {
                "auth_id": f"AUTH-{merchant.id}-0",
                "mid": merchant.platform_mid,
                "amount": round(daily / 4.0, 2),
                "currency": "EUR",
                "auth_time": utcnow().isoformat(),
                "entry_mode": "ecommerce",
                "issuer_country": "GB",
                "mcc": merchant.mcc,
            }
        )
    return transactions.ingest(session, batch=batch, source_platform="acquiring")


def seed_experiment(session: Session) -> str:
    experiment = evaluation.register_experiment(
        session,
        key="EXP-CB-THRESHOLD-001",
        hypothesis=(
            "Scoring chargeback velocity over a rolling 30-day window rather than a calendar month "
            "raises agreement with analyst dispositions without increasing false positives."
        ),
        owner="model.risk@pulse.example",
        scope="monitoring alerts, smb and mid segments",
        control="merchant-risk-scorecard@2.0.0",
        variant="merchant-risk-scorecard@2.1.0-rc1",
        metric="analyst_agreement_rate",
        guardrail_metric="false_positive_rate",
        min_observations=40,
    )
    return experiment.key


def run(*, reset: bool = False) -> dict[str, Any]:
    """Idempotent-enough seed: safe on an empty database, skipped if already populated."""
    create_all()
    monitoring.register_handlers()

    with session_scope() as session:
        if session.execute(select(Entity)).scalars().first() is not None and not reset:
            return {"seeded": False, "reason": "database already populated"}

        feeds = [feed.key for feed in provenance.install(session)]
        artefacts = model_registry.install(session)
        documents = seed_knowledge(session)
        arps = arp_registry.install(session)
        monitors = [monitor.key for monitor in monitoring.install(session)]
        offboarded_entity_id = seed_offboarded_history(session)
        portfolio = seed_portfolio(session)
        seed_drift_signals(session)
        stream = seed_transaction_stream(session)
        experiment = seed_experiment(session)
        halcyon = decisioning.board(session, HALCYON_APPLICATION, actor="seed.underwriter")

        summary = {
            "seeded": True,
            "source_feeds": feeds,
            "model_artefacts": artefacts,
            "transaction_stream": stream,
            "experiment": experiment,
            "documents": documents,
            "arps": arps,
            "monitors": monitors,
            "offboarded_entity_id": offboarded_entity_id,
            "portfolio": portfolio,
            "live_application": {
                "application_id": HALCYON_APPLICATION["application_id"],
                "entity_id": halcyon["entity_id"],
                "outcome": halcyon["outcome"],
                "reason_codes": [reason["code"] for reason in halcyon["reason_codes"]],
                "case_id": halcyon["case_id"],
                "risk_score": halcyon["score"]["value"],
                "risk_band": halcyon["score"]["band"],
            },
            "audit_chain": audit.verify(session),
        }
        audit.append(
            session,
            actor="seed",
            action="platform.seeded",
            subject_type="platform",
            payload={
                "documents": documents,
                "arps": arps,
                "merchants": len(portfolio) + 2,
            },
        )
        return summary


if __name__ == "__main__":  # pragma: no cover - operational entrypoint
    import json

    print(json.dumps(run(), indent=2, default=str))
