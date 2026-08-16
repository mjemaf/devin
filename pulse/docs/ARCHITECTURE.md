# PULSE Architecture

Companion to [MEGAPLAN.md](./MEGAPLAN.md) and [GOVERNANCE.md](./GOVERNANCE.md). Aligned to the
PULSE Technical Architecture. This document describes the target architecture, the PLS component
register, and exactly how much of each component is real in this repository.

The register is not prose — it is data, served by the platform itself:

| Surface | Answers |
| --- | --- |
| `GET /api/platform/architecture` | principles, commitments, NFR targets, coverage by layer and state |
| `GET /api/platform/components` | every PLS component with layer, horizon, state, modules, published topics |
| `GET /api/platform/traceability` | use case → components → delivery state, ADR register, unmapped components |
| `GET /api/platform/roadmap` | H0–H5 with delivered/total per horizon |

Source of truth: `backend/app/services/components.py`. A component may only claim `implemented`
if it names Python modules that import — asserted in `backend/tests/test_api_architecture.py`.

## 1. Principles and commitments

| | Principle |
| --- | --- |
| P1 | Grounded by default: no assertion without a citable source |
| P2 | Single master per entity, federated ownership of attributes |
| P3 | Bi-temporal everything: world time and system time on every record |
| P4 | Deterministic before probabilistic before paid |
| P5 | Composable capability: one behaviour, one owner, many consumers |
| P6 | Human accountability preserved for every consequential decision |
| P7 | Event-driven by default; synchronous coupling only for stated-SLA reads |
| P8 | Configuration over release: thresholds and policy change without a deploy |
| P9 | Observability as a build requirement, not an afterthought |
| P10 | Reuse the approved estate before adding new infrastructure |

Commitments are the testable form of the principles:

| | Commitment | Enforced by |
| --- | --- | --- |
| C1 | Every answer, score and recommendation carries citations with provenance and freshness | `services/provenance.py`, `services/knowledge.py`, `Decision.fact_provenance` |
| C2 | The knowledge graph is a system of reference, never a system of record | graph edges derive from `Fact` rows; masters stay in `PLS-17` bindings |
| C3 | Policy, rules, thresholds and facts are versioned, retrievable and replayable | bi-temporal `Fact`, policy packs, `GET /api/decisions/{id}/replay` |
| C4 | Deterministic rules run before internal models, which run before paid vendors | `services/policy.py` → `services/scoring.py` → `providers/` gateway tiering |
| C5 | Agents hold no source-system credentials; access is brokered, scoped and logged | `services/action_broker.py`, `services/entitlements.py` |
| C6 | Every consequential decision has a named, timestamped accountable human | `Decision.accountable_party`/`accountable_at`, `services/four_eyes.py` |
| C7 | Every state transition publishes a canonical event | `services/events.py` (topic + schema registry) |
| C8 | PII is detected and tokenised before storage; residency is configuration | `Fact.classification`, `EntitlementContext.region`, gateway routing |

## 2. Layers

### Foundation / data (PLS-10 … PLS-17)

| PLS | Component | Reference impl |
| --- | --- | --- |
| PLS-10 | Source connectivity & ingestion | `services/provenance.py` (`SourceFeed` health, criticality tiers) |
| PLS-11 | Third-party vendor gateway | `providers/` — metered, cached, cost-attributed, tiered |
| PLS-12 | Document & evidence repository | `services/knowledge.py`, `EvidenceDocument` |
| PLS-13 | Event fabric & topic registry | `services/events.py` |
| PLS-14 | Data quality, lineage & provenance | `services/provenance.py` (`effective`, conflict sets) |
| PLS-15 | Feature store (single definition, online + offline) | `services/features.py` |
| PLS-16 | Transaction stream normalisation | `services/transactions.py` (normalisation, FX, dedupe) |
| PLS-17 | Reference & master data binding | `services/resolution.py`, entity/merchant masters |

**Bi-temporal fact model (P3).** Every externally-sourced or derived attribute is a `Fact` with
world time (`valid_from`/`valid_to`) *and* system time (`recorded_at`/`superseded_at`), plus
`source_ref`, `extraction_method`, `confidence`, `content_hash`, `classification`, `conflict_set`
and `resolution_rule`. Nothing is updated in place: a new observation supersedes its predecessor
and the loser stays queryable, which is what makes "as known on date X" answerable and makes any
decision replayable.

**Event fabric (C7, P7).** Topics are `{env}.risk.{domain}.{entity}.{version}`:

```
risk.entity.resolved.v1        risk.ownership.changed.v1     risk.knowledge.updated.v1
risk.policy.version.published.v1  risk.signal.raised.v1      risk.assessment.completed.v1
risk.decision.recorded.v1      risk.case.lifecycle.v1        risk.screening.hit.v1
risk.monitoring.refresh.v1     risk.transaction.normalised.v1
risk.action.executed.v1        risk.outcome.labelled.v1
```

Each topic carries a required-field schema and a retention period (longest applicable compliance
obligation; 7–10 years for decision, action and outcome topics). Publishing an event that fails
its schema raises rather than silently degrading the log. Consumers are idempotent — replay
(`POST /api/platform/events/replay`) is a supported operation, dry-runnable, and re-delivering an
already-processed event is a no-op. Breaking changes take a new topic version with a dual-write
window, never an in-place field change.

### KNOW (PLS-20 … PLS-27)

Knowledge base and policy corpus, entity resolution, KYB/identity, UBO graph, network/link
analysis, screening, merchant history, Merchant 360 projection.

- **Retrieval (PLS-23).** Lexical BM25 over approved, in-force chunks only; drafts are never
  citable (ADR-011). Composition is extractive and every sentence cites
  `(document, version, chunk)`. Below the grounding floor the answer is a **logged refusal** and
  the gap is queued as a knowledge-improvement candidate.
- **Policy as code (PLS-24).** Declarative YAML packs with a whitelisted expression AST — no
  arbitrary code execution (ADR-003); jurisdiction/segment predicates, effective dates,
  thresholds and citations back into the corpus. Unsupported expressions fail closed to referral.
- **Entity resolution (PLS-21).** Deterministic identifier binding first, then explainable scored
  candidates; merge and review thresholds are configuration (ADR-004). Publishes
  `risk.entity.resolved.v1`.
- **Graph (PLS-22).** Ownership and network edges are relational and traversed in the service
  layer (ADR-001); three hops inside the latency target at reference scale. The graph is a system
  of *reference* (C2).

### DETECT (PLS-30 … PLS-42)

Deterministic rules and decisioning, model scoring and serving, materiality and triggers,
signals/alerting, peer cohorts, classification, perpetual monitoring, screening refresh, and
transaction-time detection.

- **Ordering (C4/P4).** Rules answer the authorisation path; models and paid vendors are
  asynchronous (ADR-009), so the 150 ms authorisation target never depends on inference.
- **Materiality (PLS-32).** One function mapping (exposure, reversibility, adversity, confidence)
  → required oversight. It, not the use case, decides whether a machine may act alone.
- **Features (PLS-15/PLS-31).** A feature is declared once and the same definition serves online
  and offline, with `definition_versions` returned alongside values, so there is no train/serve
  skew by construction (ADR-005).
- **Perpetual monitoring (PLS-40/41/42).** Cadence *and* event triggers; recompute diffs against
  last known state and only material change raises a signal.

### ACT (PLS-50 … PLS-55)

| PLS | Component | Reference impl |
| --- | --- | --- |
| PLS-50 | Agent runtime & ARP executor | `services/agents.py` |
| PLS-51 | Workflow & orchestration binding | `services/cases.py`, `services/requirements.py` |
| PLS-52 | Outcome & feedback loop | `services/outcomes.py` |
| PLS-53 | Action broker | `services/action_broker.py` |
| PLS-54 | Requirement & request orchestration | `services/requirements.py` |
| PLS-55 | Document generation (incl. adverse action) | `services/explainability.py` |

The **action broker** is the only path to a consequential effect. It refuses an action whose
decision class requires approval unless a satisfied `ApprovalRequest` is supplied, records
authority basis and rule version, issues a rollback token with an expiry, restores the *prior*
state on rollback, and reconciles platform state against its own ledger to detect bypass.

### Engagement (PLS-60 … PLS-65)

Analyst console (this repo's frontend), merchant portal, partner console, comms/task inbox, APIs.
No surface reads the database directly; the intelligence API is the only contract (P5).

### Governance spine (PLS-70 … PLS-75) and AI access spine (PLS-80 … PLS-85)

Cross-cutting, never per-use-case: immutable audit and evidence ledger, MRM registry, ARP
registry with the four-eyes service, evaluation/backtest/drift, explainability and adverse
action, entitlements and segregation of duties; then the AI model gateway, agent/skill registry,
context assembly, AI cost metering, sandbox, and experimentation. Detail in
[GOVERNANCE.md](./GOVERNANCE.md).

## 3. Request paths

**Boarding decision (synchronous, latency-critical)**
```
application → entity.resolve → gateway (registry/KYB, cached) → screening
           → features (versioned defs) → policy-as-code evaluate → materiality
           → [bounded-auto ? decide : case + agent recommendation via four-eyes]
           → decision written with facts_relied + fact_provenance + model_versions
             + accountable_party + degraded_checks
           → audit.append + risk.decision.recorded.v1
```

**Perpetual monitoring (event/cadence-driven)**
```
list update | registry change | transaction signal | cadence tick
   → monitor registry selects affected resolved entities
   → recompute facts (bi-temporal supersession) + scores → diff vs last known state
   → material change ? risk.signal.raised.v1 + case + ARP run : silent state update
   → audit.append
```

**Grounded question**
```
question → context assembly (entitlement + residency + freshness filtered)
        → retrieve(top-k, effective_date) → grounding floor
        → answer with citations | logged refusal → knowledge-gap queue
        → AI gateway logs tokens, cost, provider, classification
```

**Consequential action**
```
recommendation → materiality → approval request (proposer ≠ approver)
              → action broker (authority basis, scope, rollback token)
              → risk.action.executed.v1 → outcome label → drift/eval feedback
```

## 4. Non-functional targets

Held as data in `components.NFR_TARGETS` and served by `/api/platform/architecture`.

| Path | Target |
| --- | --- |
| Transaction normalisation → detection | p99 < 2 s |
| Authorisation decision | p99 < 150 ms |
| Online model / feature serving | p95 < 300 ms |
| Entity resolution | p95 < 800 ms |
| Three-hop ownership traversal | p95 < 400 ms |
| Grounded policy answer | p95 < 4 s |
| Grounded answer with graph context | p95 < 8 s |
| Merchant 360 projection | p95 < 1.5 s |
| Signal → analyst inbox | p95 < 10 s |
| Agent case recommendation | p95 < 30 s |

Availability is tiered by criticality (tier 0: 99.99 %, RTO 15 min, RPO by event replay; through
tier 3: 99.0 %, RTO 24 h). Degradation is always an explicit, logged, alarmed state — stale or
unavailable inputs appear on the decision as `degraded_checks`, never as silence.

## 5. Reference implementation map

```
backend/app/
  main.py, db.py, config.py     app wiring, engine/session, settings
  models.py                     canonical schema incl. bi-temporal Fact, PlatformEvent,
                                SourceFeed, ModelArtefact, ModelInvocation, ApprovalRequest,
                                BrokeredAction, OutcomeLabel, TransactionEvent, Requirement,
                                Experiment
  api/routes.py, api/schemas.py API surface and contracts
  services/
    components.py     PLS register, ADRs, NFR targets, traceability, roadmap
    events.py         topic + schema registry, durable publish, replay, idempotency
    provenance.py     bi-temporal effective view, conflicts, freshness, citation bundles
    entitlements.py   scope intersection, classification ceilings, region, SoD
    model_registry.py model artefacts and runnable-state gating
    ai_gateway.py     single inference egress: routing, classification, cost, citations
    context_assembly.py  scoped, freshness-stamped context for any generated answer
    four_eyes.py      approval requests, proposer ≠ approver, rationale required
    action_broker.py  brokered effects, rollback, bypass reconciliation
    outcomes.py       outcome labels feeding evaluation
    features.py       versioned feature definitions
    transactions.py   normalisation, FX, dedupe, exposure
    requirements.py   requirement catalogue, satisfaction, overdue escalation
    explainability.py reason codes, counterfactuals, adverse-action notices, replay
    evaluation.py     backtests, drift, autonomy demotion
    knowledge.py resolution.py graph.py screening.py classification.py scoring.py
    policy.py monitoring.py agents.py cases.py audit.py
  providers/                    simulated vendor adapters behind production-shaped interfaces
  policies/                     YAML policy packs
frontend/                       React + Vite analyst console
```

## 6. ADR register

Twelve accepted decisions (`GET /api/platform/adrs`), covering the graph store, retrieval
architecture, policy-as-code representation, entity-resolution build-vs-vendor, feature-store
ownership, model-provider strategy, agent framework, audit ledger, the real-time decision path,
residency topology, the approved-corpus boundary, and (open) product catalogue/pricing.

## 7. Deliberate deviations from production

| Production | Here | Why it is not a redesign |
| --- | --- | --- |
| Kafka | Durable in-process fabric with the same topic/schema/retention/replay contract (`PlatformEvent`) | Publishers and consumers speak topics and idempotent replay already |
| Postgres + pgvector, object store | SQLite + local files | Storage is behind the ORM and the document store |
| Hosted LLM | Deterministic local provider behind the AI gateway (ADR-006) | Grounding, cost metering and refusal are structural, not prompt-level |
| Real registry / sanctions / bureau vendors | Simulated providers with the same adapter interface, latency and cost metering | Gateway, caching, tiering and cost attribution are exercised for real |
| Temporal / durable workflow engine | Case orchestration with the same state contract | Workflow binding is an adapter behind `services/cases.py` |
| OIDC + org entitlements | Header-based dev identities with roles | SoD and four-eyes logic stays real and testable |

Components whose production form is an adapter swap are marked `reference` in the register, not
`implemented`. Components with no code are `planned`. `/api/platform/architecture` reports the
split, so the honest status of the build is queryable rather than claimed.
