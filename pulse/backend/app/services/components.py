"""The PLS component register: the architecture as data rather than as a diagram.

Every capability in the technical architecture has an identifier (PLS-nn), a layer, a delivery
horizon and a delivery state in *this* repository. Keeping the register in code means the platform
can answer "which component owns this behaviour, and is it real yet?" — and the traceability view
below turns the use-case inventory into a coverage report instead of a promise.

``state`` is deliberately honest:

* ``implemented`` — the behaviour exists and is exercised by tests.
* ``reference`` — a working, contract-shaped stand-in whose production form is an adapter swap
  (in-process event fabric, deterministic local model provider, synthetic vendor feeds).
* ``planned`` — declared with an owner and horizon, no code yet.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

State = Literal["implemented", "reference", "planned"]
Layer = Literal["data", "know", "detect", "act", "engagement", "governance", "ai_access"]


@dataclass(frozen=True)
class Component:
    id: str
    name: str
    layer: Layer
    horizon: str
    state: State
    responsibility: str
    modules: tuple[str, ...] = ()
    publishes: tuple[str, ...] = ()
    notes: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "layer": self.layer,
            "horizon": self.horizon,
            "state": self.state,
            "responsibility": self.responsibility,
            "modules": list(self.modules),
            "publishes": list(self.publishes),
            "notes": self.notes,
        }


COMPONENTS: tuple[Component, ...] = (
    # --- Data / foundation -----------------------------------------------------------------
    Component(
        "PLS-10",
        "Source Connectivity & Ingestion",
        "data",
        "H1",
        "reference",
        "Registered feeds with owners, freshness SLAs, PII flags and observed health.",
        ("app.services.provenance", "app.providers"),
    ),
    Component(
        "PLS-11",
        "Third-Party Vendor Gateway",
        "data",
        "H1",
        "implemented",
        "The single governed egress to paid data: cached, metered, cost-attributed, degradable.",
        ("app.providers.gateway",),
    ),
    Component(
        "PLS-12",
        "Document & Evidence Repository",
        "data",
        "H1",
        "implemented",
        "Versioned, checksummed documents and the evidence cited by decisions.",
        ("app.services.knowledge",),
    ),
    Component(
        "PLS-13",
        "Event Fabric",
        "data",
        "H1",
        "reference",
        "Durable, versioned canonical topics with idempotent consumers and replay.",
        ("app.services.events",),
        publishes=("all",),
        notes="In-process broker with durable PlatformEvent records; Kafka/PubSub is an adapter swap.",
    ),
    Component(
        "PLS-14",
        "Data Quality, Lineage & Provenance",
        "data",
        "H1",
        "implemented",
        "Bi-temporal facts, per-attribute provenance, conflict sets, freshness and staleness.",
        ("app.services.provenance",),
    ),
    Component(
        "PLS-15",
        "Feature Store",
        "data",
        "H3",
        "reference",
        "Declared features with owners, freshness and the same definition online and offline.",
        ("app.services.features",),
    ),
    Component(
        "PLS-16",
        "Transaction Stream Normalisation",
        "data",
        "H3",
        "implemented",
        "Canonical transaction events, deduplicated, before any detection logic sees them.",
        ("app.services.transactions",),
        publishes=("risk.transaction.normalised.v1",),
    ),
    Component(
        "PLS-17",
        "Reference & Master Data Binding",
        "data",
        "H1",
        "implemented",
        "Identifier binding between Pulse entities and source-system keys.",
        ("app.services.resolution",),
    ),
    # --- KNOW ------------------------------------------------------------------------------
    Component(
        "PLS-20",
        "Knowledge Base Core",
        "know",
        "H1",
        "implemented",
        "The approved corpus: what Pulse is allowed to know and cite.",
        ("app.services.knowledge",),
        publishes=("risk.knowledge.updated.v1",),
    ),
    Component(
        "PLS-21",
        "Entity Resolution",
        "know",
        "H2",
        "implemented",
        "One canonical entity per real-world party, with confidence bands and review queues.",
        ("app.services.resolution",),
        publishes=("risk.entity.resolved.v1",),
    ),
    Component(
        "PLS-22",
        "Knowledge Graph",
        "know",
        "H2",
        "implemented",
        "Ownership and network traversal as a system of reference, never of record.",
        ("app.services.graph",),
        publishes=("risk.ownership.changed.v1",),
    ),
    Component(
        "PLS-23",
        "Semantic & Retrieval Layer",
        "know",
        "H1",
        "reference",
        "Lexical retrieval over approved, in-force chunks with entitlement filtering.",
        ("app.services.knowledge",),
        notes="BM25 over the approved corpus; a hybrid vector index is ADR-002.",
    ),
    Component(
        "PLS-24",
        "Policy & Regulatory Store / Policy-as-Code",
        "know",
        "H1",
        "implemented",
        "Versioned, effective-dated, jurisdiction-overlaid executable policy.",
        ("app.services.policy",),
        publishes=("risk.policy.version.published.v1",),
    ),
    Component(
        "PLS-25",
        "Grounded Answer Service",
        "know",
        "H1",
        "implemented",
        "Cited answers or an explicit refusal; knowledge gaps are logged, never guessed.",
        ("app.services.knowledge",),
    ),
    Component(
        "PLS-26",
        "Memory & Case Context",
        "know",
        "H2",
        "implemented",
        "Case history and prior dispositions as first-class context.",
        ("app.services.cases",),
    ),
    Component(
        "PLS-27",
        "Merchant 360 Projection",
        "know",
        "H1",
        "implemented",
        "One read model assembling identity, ownership, risk, cases and history.",
        ("app.services.merchant360",),
    ),
    # --- DETECT ----------------------------------------------------------------------------
    Component(
        "PLS-30",
        "Rules & Decision Engine",
        "detect",
        "H2",
        "implemented",
        "Deterministic evaluation first, with rule traces, reason codes and counterfactuals.",
        ("app.services.policy", "app.services.decisioning"),
        publishes=("risk.decision.recorded.v1", "risk.assessment.completed.v1"),
    ),
    Component(
        "PLS-31",
        "Scoring & Model Serving",
        "detect",
        "H3",
        "implemented",
        "Registered, explainable scoring with per-signal contributions and cohort context.",
        ("app.services.scoring",),
    ),
    Component(
        "PLS-32",
        "Materiality & Trigger Engine",
        "detect",
        "H3",
        "implemented",
        "Consequence, not confidence, decides how much autonomy an action may have.",
        ("app.services.materiality",),
    ),
    Component(
        "PLS-33",
        "Signal & Alert Service",
        "detect",
        "H3",
        "implemented",
        "Deduplicated alerts with severity, occurrences and case binding.",
        ("app.services.monitoring",),
        publishes=("risk.signal.raised.v1",),
    ),
    Component(
        "PLS-34",
        "Peer Cohort & Benchmarking",
        "detect",
        "H3",
        "implemented",
        "Comparison against a like-for-like cohort rather than a global threshold.",
        ("app.services.scoring",),
    ),
    Component(
        "PLS-40",
        "Classification",
        "detect",
        "H2",
        "implemented",
        "Business model, MCC and prohibited-activity classification with drift detection.",
        ("app.services.monitoring", "app.services.scoring"),
    ),
    Component(
        "PLS-41",
        "Perpetual Monitoring",
        "detect",
        "H3",
        "implemented",
        "Event-driven reassessment of the affected population, not an annual calendar.",
        ("app.services.monitoring",),
        publishes=("risk.monitoring.refresh.v1",),
    ),
    Component(
        "PLS-42",
        "Screening",
        "detect",
        "H2",
        "implemented",
        "Sanctions, PEP, watchlist, negative-file and adverse-media screening with demotions.",
        ("app.services.screening",),
        publishes=("risk.screening.hit.v1",),
    ),
    # --- ACT -------------------------------------------------------------------------------
    Component(
        "PLS-50",
        "Agent Runtime & ARP Executor",
        "act",
        "H4",
        "implemented",
        "Runs pathways inside their declared scope, tier and ceiling; no credentials, no browser.",
        ("app.services.agents",),
    ),
    Component(
        "PLS-51",
        "Workflow & Orchestration Binding",
        "act",
        "H2",
        "reference",
        "Durable case and requirement lifecycles bound to canonical events.",
        ("app.services.cases", "app.services.requirements"),
    ),
    Component(
        "PLS-52",
        "Outcome & Feedback",
        "act",
        "H3",
        "implemented",
        "Mandatory labelled dispositions feeding evaluation, drift and knowledge curation.",
        ("app.services.outcomes",),
        publishes=("risk.outcome.labelled.v1",),
    ),
    Component(
        "PLS-53",
        "Action Broker",
        "act",
        "H4",
        "implemented",
        "The only path to a consequential external action, with authority, evidence and rollback.",
        ("app.services.action_broker",),
        publishes=("risk.action.executed.v1",),
    ),
    Component(
        "PLS-54",
        "Requirement & Request Orchestration",
        "act",
        "H4",
        "implemented",
        "Outstanding requirements tracked to closure with due dates and escalation.",
        ("app.services.requirements",),
    ),
    Component(
        "PLS-55",
        "Document Generation",
        "act",
        "H4",
        "implemented",
        "Adverse-action and decision notices generated from the decision record itself.",
        ("app.services.explainability",),
    ),
    # --- Engagement ------------------------------------------------------------------------
    Component(
        "PLS-60",
        "Analyst Workbench & Case Management",
        "engagement",
        "H2",
        "implemented",
        "Where analysts see the evidence, dispose of work and remain accountable.",
        ("app.api.routes", "frontend/src/pages"),
    ),
    Component(
        "PLS-61",
        "Merchant Portal & Assistant",
        "engagement",
        "H2",
        "planned",
        "Merchant-facing requirement submission and grounded assistant.",
    ),
    Component(
        "PLS-62",
        "Partner Oversight Console",
        "engagement",
        "H5",
        "planned",
        "Partner and portfolio-level control assessment.",
    ),
    Component(
        "PLS-63",
        "Notification, Communications & Task Inbox",
        "engagement",
        "H5",
        "planned",
        "One inbox for tasks, approvals and communications.",
    ),
    Component(
        "PLS-64",
        "Reporting, Search & Self-Service Analytics",
        "engagement",
        "H5",
        "reference",
        "Portfolio overview, cohort statistics and examiner-ready exports.",
        ("app.api.routes", "app.services.audit"),
    ),
    Component(
        "PLS-65",
        "External and Embedded API Surface",
        "engagement",
        "H5",
        "reference",
        "Versioned, entitlement-scoped, metered contracts for internal consumers.",
        ("app.api.routes",),
    ),
    # --- Governance spine ------------------------------------------------------------------
    Component(
        "PLS-70",
        "Immutable Audit & Evidence Ledger",
        "governance",
        "H1",
        "implemented",
        "One append-only hash-chained log for every machine and human action.",
        ("app.services.audit",),
    ),
    Component(
        "PLS-71",
        "Model Risk Management Registry",
        "governance",
        "H1",
        "implemented",
        "Nothing unregistered or unvalidated executes: models, rules, prompts and agents.",
        ("app.services.model_registry",),
    ),
    Component(
        "PLS-72",
        "ARP Registry & Four-Eyes",
        "governance",
        "H1",
        "implemented",
        "Pathway registration plus dual authorisation as a shared primitive.",
        ("app.services.arp_registry", "app.services.four_eyes"),
    ),
    Component(
        "PLS-73",
        "Evaluation, Backtest & Drift",
        "governance",
        "H3",
        "implemented",
        "Promotion evidence, drift detection and automatic demotion.",
        ("app.services.evaluation",),
    ),
    Component(
        "PLS-74",
        "Explainability & Adverse Action",
        "governance",
        "H4",
        "implemented",
        "Layered explanation, counterfactuals, decision replay and notice generation.",
        ("app.services.explainability",),
    ),
    Component(
        "PLS-75",
        "Entitlements, Access & Segregation of Duties",
        "governance",
        "H1",
        "implemented",
        "Data scope is the intersection of pathway scope and caller entitlements, never the union.",
        ("app.services.entitlements",),
    ),
    # --- AI access spine -------------------------------------------------------------------
    Component(
        "PLS-80",
        "AI Model Gateway",
        "ai_access",
        "H1",
        "reference",
        "The only path to inference: registered artefacts, residency, budget, full invocation log.",
        ("app.services.ai_gateway",),
    ),
    Component(
        "PLS-81",
        "Agent & Skill Registry",
        "ai_access",
        "H1",
        "implemented",
        "Declared pathways, tools, prompt versions and model bindings.",
        ("app.services.arp_registry", "app.services.agents"),
    ),
    Component(
        "PLS-82",
        "Context Assembly",
        "ai_access",
        "H1",
        "implemented",
        "Agents receive bounded, provenance-tagged, entitlement-filtered context and nothing else.",
        ("app.services.context_assembly",),
    ),
    Component(
        "PLS-83",
        "AI Cost Management & Metering",
        "ai_access",
        "H1",
        "implemented",
        "Per-use-case spend, budgets and refusal when a budget is exhausted.",
        ("app.services.ai_gateway",),
    ),
    Component(
        "PLS-84",
        "Sandbox & Safe Testing",
        "ai_access",
        "H1",
        "reference",
        "Synthetic fixtures and a deterministic provider so evaluation needs no production data.",
        ("app.providers._fixtures", "app.seed"),
    ),
    Component(
        "PLS-85",
        "Experimentation",
        "ai_access",
        "H3",
        "implemented",
        "Registered champion/challenger and shadow experiments with a declared success measure.",
        ("app.services.evaluation",),
    ),
)

BY_ID: dict[str, Component] = {component.id: component for component in COMPONENTS}


@dataclass(frozen=True)
class UseCase:
    id: str
    name: str
    lifecycle_stage: str
    horizon: str
    components: tuple[str, ...]
    state: State
    entry_point: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "lifecycle_stage": self.lifecycle_stage,
            "horizon": self.horizon,
            "components": list(self.components),
            "state": self.state,
            "entry_point": self.entry_point,
        }


USE_CASES: tuple[UseCase, ...] = (
    UseCase(
        "UC-01",
        "Grounded policy Q&A",
        "analyst enablement",
        "H1",
        ("PLS-12", "PLS-20", "PLS-23", "PLS-24", "PLS-25", "PLS-70", "PLS-80", "PLS-82"),
        "implemented",
        "POST /api/knowledge/ask",
    ),
    UseCase(
        "UC-02",
        "Intake, KYB and true merchant identity",
        "onboarding",
        "H2",
        ("PLS-11", "PLS-14", "PLS-17", "PLS-21", "PLS-22", "PLS-27"),
        "implemented",
        "POST /api/boarding/applications",
    ),
    UseCase(
        "UC-03",
        "UBO discovery and network traversal",
        "onboarding",
        "H2",
        ("PLS-22", "PLS-42"),
        "implemented",
        "GET /api/merchants/{id}/graph",
    ),
    UseCase(
        "UC-04",
        "Boarding decision with reason codes",
        "boarding",
        "H4",
        ("PLS-30", "PLS-31", "PLS-32", "PLS-74", "PLS-53"),
        "implemented",
        "POST /api/boarding/applications",
    ),
    UseCase(
        "UC-05",
        "Perpetual monitoring and screening refresh",
        "post-boarding",
        "H3",
        ("PLS-33", "PLS-41", "PLS-42", "PLS-13"),
        "implemented",
        "POST /api/monitoring/sweep",
    ),
    UseCase(
        "UC-06",
        "Transaction-time detection",
        "post-boarding",
        "H3",
        ("PLS-16", "PLS-15", "PLS-30", "PLS-33"),
        "implemented",
        "POST /api/transactions/normalise",
    ),
    UseCase(
        "UC-07",
        "Credit and reserve management",
        "credit",
        "H3",
        ("PLS-31", "PLS-32", "PLS-54", "PLS-74"),
        "reference",
        "GET /api/merchants/{id}",
    ),
    UseCase(
        "UC-08",
        "Governed agent-assisted case work",
        "analyst enablement",
        "H4",
        ("PLS-50", "PLS-52", "PLS-53", "PLS-72", "PLS-81", "PLS-82"),
        "implemented",
        "POST /api/agents/runs/{id}/review",
    ),
    UseCase(
        "UC-09",
        "Offboarding and termination",
        "offboarding",
        "H4",
        ("PLS-30", "PLS-53", "PLS-55", "PLS-74"),
        "implemented",
        "POST /api/monitoring/events/offboard",
    ),
    UseCase(
        "UC-10",
        "Examiner-ready evidence export",
        "assurance",
        "H1",
        ("PLS-70", "PLS-64", "PLS-74"),
        "implemented",
        "GET /api/audit/export/{id}",
    ),
    UseCase(
        "UC-11",
        "Partner oversight",
        "partner",
        "H5",
        ("PLS-62", "PLS-64"),
        "planned",
    ),
    UseCase(
        "UC-12",
        "Merchant self-service requirements",
        "engagement",
        "H5",
        ("PLS-54", "PLS-61", "PLS-63"),
        "reference",
        "GET /api/requirements",
    ),
)


@dataclass(frozen=True)
class Adr:
    id: str
    title: str
    decision: str
    status: str
    consequence: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "decision": self.decision,
            "status": self.status,
            "consequence": self.consequence,
        }


ADRS: tuple[Adr, ...] = (
    Adr(
        "ADR-001",
        "Graph store",
        "Ownership and network edges are held relationally and traversed in the service layer.",
        "accepted for the reference build",
        "Three-hop traversal stays within the latency target at reference scale; a property graph "
        "becomes an adapter behind app.services.graph if traversal depth grows.",
    ),
    Adr(
        "ADR-002",
        "Retrieval architecture",
        "Lexical BM25 over approved, in-force chunks; grounding enforced by a coverage floor.",
        "accepted, revisit in H2",
        "No embedding infrastructure or third-party inference is needed to prove refusal behaviour; "
        "hybrid retrieval is additive.",
    ),
    Adr(
        "ADR-003",
        "Policy-as-code representation",
        "Declarative YAML packs with a whitelisted expression AST, no arbitrary code execution.",
        "accepted",
        "Policy is reviewable by risk owners and cannot execute anything unexpected; unsupported "
        "expressions fail closed to referral.",
    ),
    Adr(
        "ADR-004",
        "Entity resolution build vs vendor",
        "Deterministic identifier binding plus explainable scored candidates, built in-house.",
        "accepted",
        "Merge and review thresholds are configuration; a vendor becomes one more scored signal.",
    ),
    Adr(
        "ADR-005",
        "Feature store ownership",
        "Features are declared once with a single definition used online and offline.",
        "accepted",
        "No train/serve skew by construction; the physical store is deferred to H3.",
    ),
    Adr(
        "ADR-006",
        "Model provider strategy",
        "All inference passes the AI gateway; the default provider is deterministic and local.",
        "accepted",
        "Provider choice, residency and budget are configuration, not code changes.",
    ),
    Adr(
        "ADR-007",
        "Agent framework",
        "Pathways are declarative ARPs executed by a first-party runtime, not a framework agent.",
        "accepted",
        "Tool scope, data scope, tier and ceiling are enforceable in one place.",
    ),
    Adr(
        "ADR-008",
        "Audit ledger",
        "A single append-only hash-chained log, verified on demand, with no per-capability tables.",
        "accepted",
        "Tamper evidence is a property of the platform rather than of each feature.",
    ),
    Adr(
        "ADR-009",
        "Real-time decision path",
        "Deterministic rules answer the authorisation path; models and vendors are asynchronous.",
        "accepted",
        "The 150 ms authorisation target does not depend on inference or paid lookups.",
    ),
    Adr(
        "ADR-010",
        "Residency topology",
        "Residency is per-entity configuration honoured by storage, retrieval and model routing.",
        "accepted",
        "A new region is configuration plus a gateway route, not a fork of the platform.",
    ),
    Adr(
        "ADR-011",
        "Approved knowledge corpus boundary",
        "Only approved, in-force document versions are retrievable; drafts are never citable.",
        "accepted",
        "Grounding and refusal are structural, not prompt instructions.",
    ),
    Adr(
        "ADR-012",
        "Product catalogue and pricing interaction",
        "Monetisation surfaces are deferred; internal contracts are versioned and metered now.",
        "open",
        "Commercial exposure can be added without re-architecting the API surface.",
    ),
)


# Non-functional targets, held as data so the platform can report against them.
NFR_TARGETS: dict[str, dict[str, Any]] = {
    "latency_ms": {
        "transaction_normalisation_to_detection_p99": 2000,
        "authorisation_decision_p99": 150,
        "model_inference_p95": 300,
        "entity_resolution_p95": 800,
        "ownership_traversal_3_hops_p95": 400,
        "grounded_policy_answer_p95": 4000,
        "grounded_answer_with_graph_context_p95": 8000,
        "merchant_360_projection_p95": 1500,
        "signal_to_analyst_inbox_p95": 10000,
        "agent_case_recommendation_p95": 30000,
    },
    "availability_tiers": {
        "0": {"availability": 99.99, "rto_minutes": 15, "rpo": "event replay"},
        "1": {"availability": 99.9, "rto_minutes": 60, "rpo": "5 minutes"},
        "2": {"availability": 99.5, "rto_minutes": 240, "rpo": "1 hour"},
        "3": {"availability": 99.0, "rto_minutes": 1440, "rpo": "24 hours"},
    },
}

PRINCIPLES: tuple[tuple[str, str], ...] = (
    ("P1", "Grounded by default: no assertion without a citable source."),
    ("P2", "Single master per entity, federated ownership of attributes."),
    ("P3", "Bi-temporal everything: world time and system time on every record."),
    ("P4", "Deterministic before probabilistic before paid."),
    ("P5", "Composable capability: one behaviour, one owner, many consumers."),
    ("P6", "Human accountability preserved for every consequential decision."),
    ("P7", "Event-driven by default; synchronous coupling only for stated-SLA reads."),
    ("P8", "Configuration over release: thresholds and policy change without a deploy."),
    ("P9", "Observability as a build requirement, not an afterthought."),
    ("P10", "Reuse the approved estate before adding new infrastructure."),
)

COMMITMENTS: tuple[tuple[str, str], ...] = (
    ("C1", "Every answer, score and recommendation carries citations with provenance and freshness."),
    ("C2", "The knowledge graph is a system of reference, never a system of record."),
    ("C3", "Policy, rules, thresholds and facts are versioned, retrievable and replayable."),
    ("C4", "Deterministic rules run before internal models, which run before paid vendors."),
    ("C5", "Agents hold no source-system credentials; access is brokered, scoped and logged."),
    ("C6", "Every consequential decision has a named, timestamped accountable human."),
    ("C7", "Every state transition publishes a canonical event."),
    ("C8", "PII is detected and tokenised before storage; residency is configuration."),
)


def register() -> list[dict[str, Any]]:
    return [component.as_dict() for component in COMPONENTS]


def summary() -> dict[str, Any]:
    """Coverage by layer and state — the honest architecture status view."""
    layers: dict[str, dict[str, int]] = {}
    for component in COMPONENTS:
        bucket = layers.setdefault(component.layer, {"implemented": 0, "reference": 0, "planned": 0})
        bucket[component.state] += 1
    return {
        "components": len(COMPONENTS),
        "by_layer": layers,
        "by_state": {
            state: sum(1 for c in COMPONENTS if c.state == state)
            for state in ("implemented", "reference", "planned")
        },
        "principles": [{"id": pid, "statement": text} for pid, text in PRINCIPLES],
        "commitments": [{"id": cid, "statement": text} for cid, text in COMMITMENTS],
        "nfr_targets": NFR_TARGETS,
    }


def traceability() -> dict[str, Any]:
    """Use case → components → delivery state, with unmapped components called out."""
    mapped: set[str] = {cid for use_case in USE_CASES for cid in use_case.components}
    rows: list[dict[str, Any]] = []
    for use_case in USE_CASES:
        components = [BY_ID[cid] for cid in use_case.components if cid in BY_ID]
        rows.append(
            {
                **use_case.as_dict(),
                "component_detail": [
                    {"id": c.id, "name": c.name, "state": c.state} for c in components
                ],
                "blocked_by": [c.id for c in components if c.state == "planned"],
            }
        )
    return {
        "use_cases": rows,
        "unmapped_components": sorted(c.id for c in COMPONENTS if c.id not in mapped),
        "adrs": [adr.as_dict() for adr in ADRS],
    }


ROADMAP: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("H0", "Validation", ("PLS-23", "PLS-21", "PLS-70", "PLS-24")),
    (
        "H1",
        "Foundation and grounded policy Q&A",
        (
            "PLS-10",
            "PLS-11",
            "PLS-12",
            "PLS-13",
            "PLS-14",
            "PLS-17",
            "PLS-20",
            "PLS-23",
            "PLS-24",
            "PLS-25",
            "PLS-27",
            "PLS-70",
            "PLS-71",
            "PLS-72",
            "PLS-75",
            "PLS-80",
            "PLS-81",
            "PLS-82",
            "PLS-83",
            "PLS-84",
        ),
    ),
    (
        "H2",
        "Grounded intelligence",
        ("PLS-21", "PLS-22", "PLS-26", "PLS-30", "PLS-40", "PLS-42", "PLS-51", "PLS-60", "PLS-61"),
    ),
    (
        "H3",
        "Detect and perpetual monitoring",
        ("PLS-15", "PLS-16", "PLS-31", "PLS-32", "PLS-33", "PLS-34", "PLS-41", "PLS-52", "PLS-73", "PLS-85"),
    ),
    ("H4", "Act", ("PLS-50", "PLS-53", "PLS-54", "PLS-55", "PLS-74")),
    ("H5", "Scale and ecosystem", ("PLS-62", "PLS-63", "PLS-64", "PLS-65")),
)


def roadmap() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for horizon, name, component_ids in ROADMAP:
        components = [BY_ID[cid] for cid in component_ids if cid in BY_ID]
        out.append(
            {
                "horizon": horizon,
                "name": name,
                "components": [
                    {"id": c.id, "name": c.name, "state": c.state} for c in components
                ],
                "delivered": sum(1 for c in components if c.state != "planned"),
                "total": len(components),
            }
        )
    return out
