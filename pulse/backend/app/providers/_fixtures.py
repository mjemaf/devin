"""Simulated third-party datasets.

Deliberately includes the failure modes a real portfolio has: registry/applicant mismatches,
near-miss sanctions names, a PEP owner, and a previously off-boarded actor re-applying behind a
new shell company.
"""

from __future__ import annotations

from typing import Any

# (country, registration_number) -> registry record
REGISTRY: dict[str, dict[str, Any]] = {
    "GB:09112233": {
        "legal_name": "Northwind Retail Limited",
        "status": "active",
        "incorporated_on": "2014-03-11",
        "registered_address": "18 Kingsway, London, WC2B 6UN, GB",
        "sic_codes": ["47910"],
        "officers": [{"name": "Sarah Whitfield", "role": "director", "dob": "1979-06"}],
        "ownership": [{"name": "Sarah Whitfield", "percentage": 100.0, "type": "person"}],
    },
    "DE:HRB88123": {
        "legal_name": "Aurora Digital Goods GmbH",
        "status": "active",
        "incorporated_on": "2019-09-02",
        "registered_address": "Friedrichstrasse 90, 10117 Berlin, DE",
        "sic_codes": ["62010"],
        "officers": [{"name": "Jonas Brenner", "role": "geschaeftsfuehrer", "dob": "1985-01"}],
        "ownership": [
            {"name": "Aurora Holding SE", "percentage": 75.0, "type": "company"},
            {"name": "Jonas Brenner", "percentage": 25.0, "type": "person"},
        ],
    },
    "DE:HRB90211": {
        "legal_name": "Aurora Holding SE",
        "status": "active",
        "incorporated_on": "2017-04-20",
        "registered_address": "Friedrichstrasse 90, 10117 Berlin, DE",
        "sic_codes": ["64200"],
        "officers": [{"name": "Jonas Brenner", "role": "director", "dob": "1985-01"}],
        "ownership": [{"name": "Jonas Brenner", "percentage": 100.0, "type": "person"}],
    },
    "GB:07445566": {
        "legal_name": "Pinnacle Travel Services Ltd",
        "status": "active",
        "incorporated_on": "2010-11-30",
        "registered_address": "5 Ocean View, Southampton, SO14 3JL, GB",
        "sic_codes": ["79110"],
        "officers": [{"name": "Daniel Osei", "role": "director", "dob": "1972-08"}],
        "ownership": [{"name": "Daniel Osei", "percentage": 100.0, "type": "person"}],
    },
    "GB:11223344": {
        "legal_name": "Helios Nutra Ltd",
        "status": "active",
        "incorporated_on": "2018-02-14",
        "registered_address": "44 Mill Lane, Manchester, M4 1LE, GB",
        "sic_codes": ["47990"],
        "officers": [{"name": "Priya Raman", "role": "director", "dob": "1988-12"}],
        "ownership": [{"name": "Priya Raman", "percentage": 100.0, "type": "person"}],
    },
    "NL:34567890": {
        "legal_name": "Zenith Freight B.V.",
        "status": "active",
        "incorporated_on": "2012-06-05",
        "registered_address": "Havenstraat 12, 3013 AL Rotterdam, NL",
        "sic_codes": ["52291"],
        "officers": [{"name": "Willem de Vries", "role": "director", "dob": "1969-03"}],
        "ownership": [{"name": "Willem de Vries", "percentage": 100.0, "type": "person"}],
    },
    "GB:12987654": {
        "legal_name": "Vertex Digital Exchange Ltd",
        "status": "active",
        "incorporated_on": "2020-07-21",
        "registered_address": "1 Threadneedle Walk, London, EC2R 8AH, GB",
        "sic_codes": ["66190"],
        "officers": [{"name": "Elena Vasquez", "role": "director", "dob": "1981-05"}],
        "ownership": [{"name": "Elena Vasquez", "percentage": 80.0, "type": "person"}],
    },
    "GB:10555777": {
        "legal_name": "Solent Marketplace Ltd",
        "status": "active",
        "incorporated_on": "2016-05-19",
        "registered_address": "22 Dock Road, Portsmouth, PO1 3TY, GB",
        "sic_codes": ["47910"],
        "officers": [{"name": "Aisha Bello", "role": "director", "dob": "1983-10"}],
        "ownership": [{"name": "Aisha Bello", "percentage": 100.0, "type": "person"}],
    },
    # The applicant. Registry disagrees with the application form on the director's name, and the
    # registered address matches a previously off-boarded merchant.
    "GB:14778899": {
        "legal_name": "Halcyon Wellness Ltd",
        "status": "active",
        "incorporated_on": "2026-04-02",
        "registered_address": "3 Fenwick Court, Leeds, LS1 5AB, GB",
        "sic_codes": ["47990"],
        "officers": [{"name": "M. Feldman", "role": "director", "dob": "1976-11"}],
        "ownership": [{"name": "Silverline Holdings Ltd", "percentage": 60.0, "type": "company"}],
    },
    "GB:13664422": {
        "legal_name": "Silverline Holdings Ltd",
        "status": "active",
        "incorporated_on": "2022-01-18",
        "registered_address": "3 Fenwick Court, Leeds, LS1 5AB, GB",
        "sic_codes": ["64209"],
        "officers": [{"name": "Marcus Feldman", "role": "director", "dob": "1976-11"}],
        "ownership": [{"name": "Marcus Feldman", "percentage": 100.0, "type": "person"}],
    },
    "GB:08991122": {
        "legal_name": "Meridian Wellness Ltd",
        "status": "dissolved",
        "incorporated_on": "2013-09-09",
        "registered_address": "3 Fenwick Court, Leeds, LS1 5AB, GB",
        "sic_codes": ["47990"],
        "officers": [{"name": "Marcus Feldman", "role": "director", "dob": "1976-11"}],
        "ownership": [{"name": "Marcus Feldman", "percentage": 100.0, "type": "person"}],
    },
    "GB:09877665": {
        "legal_name": "Orion Vape Supplies Ltd",
        "status": "active",
        "incorporated_on": "2015-08-08",
        "registered_address": "77 Barrow Street, Bristol, BS1 6QT, GB",
        "sic_codes": ["47260"],
        "officers": [{"name": "Karl Jensen", "role": "director", "dob": "1980-02"}],
        "ownership": [{"name": "Karl Jensen", "percentage": 100.0, "type": "person"}],
    },
    "GB:12446688": {
        "legal_name": "Lumina Ads Ltd",
        "status": "active",
        "incorporated_on": "2019-10-01",
        "registered_address": "9 Peel Street, Birmingham, B1 2HN, GB",
        "sic_codes": ["73110"],
        "officers": [{"name": "Marcos Feldmann", "role": "director", "dob": "1974-04"}],
        "ownership": [{"name": "Marcos Feldmann", "percentage": 100.0, "type": "person"}],
    },
    "US:5512399": {
        "legal_name": "Cedar Point Payments Inc",
        "status": "active",
        "incorporated_on": "2011-02-02",
        "registered_address": "400 Lakeside Dr, Cleveland, OH 44113, US",
        "sic_codes": ["7389"],
        "officers": [{"name": "Robert Lang", "role": "president", "dob": "1966-07"}],
        "ownership": [{"name": "Robert Lang", "percentage": 100.0, "type": "person"}],
    },
}

SANCTIONS_LIST: list[dict[str, Any]] = [
    {
        "list_type": "sanctions",
        "list_name": "EU Consolidated Financial Sanctions",
        "name": "Marcos Feldmann",
        "aliases": ["Marco Feldmann"],
        "country": "RU",
        "date_of_birth": "1961-04",
        "programme": "EU consolidated",
        "entry_type": "person",
        "detail": "Asset freeze — designated 2023. DOB 1961-04, Russian national.",
    },
    {
        "list_type": "sanctions",
        "list_name": "OFSI Consolidated List",
        "name": "Zarech Trading LLC",
        "aliases": ["Zarech Trading"],
        "country": "IR",
        "programme": "OFSI",
        "entry_type": "company",
        "detail": "Asset freeze — Iran sanctions regime.",
    },
    {
        "list_type": "pep",
        "list_name": "Global PEP register",
        "name": "Elena Vasquez",
        "aliases": [],
        "country": "GB",
        "date_of_birth": "1981-05",
        "programme": "Regional legislature — senior official",
        "entry_type": "person",
        "detail": "Serving member of a regional legislature; domestic PEP, tier 2.",
    },
    {
        "list_type": "internal_watchlist",
        "list_name": "Pulse internal watchlist",
        "name": "Karl Jensen",
        "aliases": [],
        "country": "GB",
        "programme": "Prohibited product — vape distribution",
        "entry_type": "person",
        "detail": "Associated with prohibited-product sales under a prior MID.",
    },
    {
        "list_type": "negative_file",
        "list_name": "Scheme/internal negative file",
        "name": "Marcus Feldman",
        "aliases": ["M. Feldman", "Marc Feldman"],
        "country": "GB",
        "date_of_birth": "1976-11",
        "programme": "Off-boarded 2025 — excessive chargebacks (Meridian Wellness Ltd)",
        "entry_type": "person",
        "detail": "Terminated for cause 2025-08; MATCH/negative-file entry retained 5 years.",
    },
]

ADVERSE_MEDIA: dict[str, list[dict[str, Any]]] = {
    "Aurora Digital Goods GmbH": [
        {
            "headline": "German consumer authority warns on subscription trap practices at digital"
            " goods sellers",
            "published_on": "2026-06-18",
            "severity": "medium",
            "source": "Handelsblatt",
            "topics": ["consumer_protection", "subscription"],
        }
    ],
    "Helios Nutra Ltd": [
        {
            "headline": "Supplement seller criticised over auto-renewal billing complaints",
            "published_on": "2026-05-02",
            "severity": "medium",
            "source": "Which?",
            "topics": ["chargebacks", "consumer_protection"],
        }
    ],
    "Halcyon Wellness Ltd": [
        {
            "headline": "Former Meridian Wellness director launches new supplements venture",
            "published_on": "2026-05-20",
            "severity": "high",
            "source": "Yorkshire Business Daily",
            "topics": ["related_party", "reincarnation_risk"],
        }
    ],
    "Vertex Digital Exchange Ltd": [
        {
            "headline": "Crypto exchange faces scrutiny over source-of-funds controls",
            "published_on": "2026-03-11",
            "severity": "high",
            "source": "Financial News",
            "topics": ["aml", "source_of_funds"],
        }
    ],
}

CREDIT_FILES: dict[str, dict[str, Any]] = {
    "GB:09112233": {"credit_score": 78, "filed_turnover": 4_200_000, "ccjs": 0, "trend": "stable"},
    "DE:HRB88123": {"credit_score": 61, "filed_turnover": 9_800_000, "ccjs": 0, "trend": "down"},
    "GB:07445566": {"credit_score": 42, "filed_turnover": 12_400_000, "ccjs": 2, "trend": "down"},
    "GB:11223344": {"credit_score": 55, "filed_turnover": 2_100_000, "ccjs": 0, "trend": "stable"},
    "NL:34567890": {"credit_score": 81, "filed_turnover": 7_600_000, "ccjs": 0, "trend": "up"},
    "GB:12987654": {"credit_score": 58, "filed_turnover": 15_900_000, "ccjs": 0, "trend": "up"},
    "GB:10555777": {"credit_score": 66, "filed_turnover": 5_500_000, "ccjs": 0, "trend": "stable"},
    "GB:14778899": {"credit_score": 31, "filed_turnover": 0, "ccjs": 0, "trend": "no_history"},
    "GB:12446688": {"credit_score": 62, "filed_turnover": 1_800_000, "ccjs": 1, "trend": "stable"},
    "US:5512399": {"credit_score": 72, "filed_turnover": 22_000_000, "ccjs": 0, "trend": "stable"},
}
