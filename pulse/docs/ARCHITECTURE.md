# PULSE Architecture

Companion to [MEGAPLAN.md](./MEGAPLAN.md). This document describes the target architecture and how
the reference implementation in this repo maps onto it.

## 1. Layers

### Data layer — "grounds the intelligence layer in fact"

| Component | Responsibility | Reference impl |
| --- | --- | --- |
| Canonical model | One merchant/entity/person/document/decision schema | `backend/app/models.py` |
| Entity resolution | Cluster fragmented identifiers into a resolved entity with a confidence score and full lineage | `backend/app/services/resolution.py` |
| Third-party gateway | Single governed egress: registry, sanctions/PEP, adverse media, bureau. Metered, cached, cost-attributed, tiered (own models first) | `backend/app/providers/` |
| Document & evidence store | Immutable blobs + extracted text + PII classification + retention/legal hold | `backend/app/services/knowledge.py` (documents) |
| Event fabric | Domain events drive recompute; nothing polls | `backend/app/services/events.py` |
| Data quality & lineage | Provenance, confidence, freshness, conflict resolution on every fact | `Fact` rows carry `source`, `confidence`, `as_of` |

**Fact model.** Every externally-sourced or derived attribute is stored as a `Fact`
(`subject`, `attribute`, `value`, `source`, `confidence`, `as_of`, `superseded_by`) rather than a
mutable column. Conflicting sources coexist; a resolution policy picks the effective value and the
losing value stays queryable. This is what makes "continuously reconciled" auditable.

### Contextual layer — the Intelligence Layer

```
KNOW ─────────────────────────────► DETECT ───────────────────────► ACT
knowledge (policy corpus, RAG)      scoring (features + rules)      agents (ARPs)
entity (resolution, KYB, UBO)       materiality                     workflows / cases
screening (sanctions/PEP/media)     drift + peer cohorts            notices / RFI
graph (links, off-boarded actors)   monitors (cadence + event)       limits / holds
merchant360 + history
```

- **Semantic layer / RAG.** Chunked, effective-dated knowledge objects; hybrid retrieval
  (lexical BM25 + optional dense vectors). Answers are assembled *only* from retrieved chunks;
  every sentence carries a citation to `(document, version, chunk)`. If retrieval scores fall
  below the grounding threshold, the answer is a logged refusal with the gap recorded as a
  knowledge-base improvement candidate (the "every interaction feeds back" loop).
- **Policy as code.** Rules are declarative YAML with jurisdiction/segment predicates, effective
  dates, thresholds and citations back into the corpus. The engine can replay any past date.
- **Scoring.** Features are computed from the substrate (never bespoke per model), scores are
  written with `as_of` + input snapshot hash so any score is reproducible and explainable.
- **Materiality.** A single function that maps (exposure, reversibility, adversity, confidence)
  → required oversight. It, not the use case, decides whether a machine may act alone.

### Governance spine

Cross-cutting, not per-use-case. See [GOVERNANCE.md](./GOVERNANCE.md).

- ARP registry with autonomy tiers, data contracts, success criteria and kill switch.
- Hash-chained audit log: `event.prev_hash → event.hash`, verifiable end to end.
- Evals: golden sets + backtests + shadow-mode agreement measurement + drift.
- Explainability: reason codes, feature attribution, counterfactuals, decision path.
- Entitlements, scoping, segregation of duties, recertification.

### Engagement layer

Analyst console (this repo's frontend), merchant portal, sales tools, partner console, comms and
task inbox — all consuming the same APIs. No surface may read the database directly; the
Intelligence Layer's API is the only contract, which is what keeps capabilities reusable
("build once, use everywhere").

## 2. Request paths

**Boarding decision (synchronous, latency-critical)**
```
application → entity.resolve → gateway (registry/KYB, cached) → screening
           → features → policy-as-code evaluate → materiality
           → [auto_bounded ? decide : create case + agent recommendation]
           → audit.append  (every step)
```

**Perpetual monitoring (event/cadence-driven)**
```
list update / registry change / transaction signal / cadence tick
   → monitor registry selects affected resolved entities
   → recompute facts + scores → diff vs last state
   → material change ? alert + case + ARP run : silent state update
   → audit.append
```

**Grounded question**
```
question → retrieve(top-k, effective_date, entitlement filter)
        → grounding check → compose answer with citations | refusal
        → log Q, retrievals, answer, feedback → knowledge gap queue
```

## 3. Reference implementation map

```
backend/app/
  main.py             FastAPI app + router wiring
  db.py               engine/session (SQLite by default, Postgres via DATABASE_URL)
  models.py           canonical schema: entities, merchants, persons, facts, documents,
                      chunks, ownership edges, relationships, screening hits, scores,
                      decisions, monitors, alerts, cases, ARPs, agent runs, audit events
  schemas.py          API contracts
  routers/            knowledge, entities, screening, decisions, monitoring, agents,
                      cases, merchants, audit, admin
  services/
    knowledge.py      ingestion, chunking, versioning, retrieval, grounded answering
    resolution.py     entity resolution (deterministic + probabilistic, confidence bands)
    graph.py          UBO traversal (3 hops), link analysis, off-boarded-actor detection
    screening.py      sanctions/PEP/watchlist/adverse media matching + re-screening
    classification.py MCC / business-model classification beyond MCC
    scoring.py        feature assembly, risk score, peer cohorts, materiality
    policy.py         policy-as-code engine (YAML rules, effective dating, replay)
    monitoring.py     monitor registry, cadence + event triggers, drift, alerting
    agents.py         ARP runtime: shadow/suggest/four-eyes/auto, evals, kill switch
    cases.py          case lifecycle, tasks, evidence packs
    audit.py          hash-chained append-only log + verification + examiner export
    events.py         in-process event bus (Kafka-shaped interface)
  providers/          simulated third-party adapters behind production-shaped interfaces
  policies/           YAML policy packs (onboarding, screening, credit, offboarding)
  seed/               synthetic portfolio incl. a shell-company re-onboarding ring
frontend/             React + Vite analyst console
```

## 4. Deliberate deviations from production

| Production | Here | Why |
| --- | --- | --- |
| Postgres + pgvector, Kafka, object store | SQLite + in-process bus + local files | Runs anywhere with no infra; interfaces unchanged |
| Hosted LLM for composition | Deterministic extractive composer (`LLM_PROVIDER=local`) | No keys required; grounding is enforced structurally, not by prompt |
| Real registry / sanctions / bureau vendors | Simulated providers with the same adapter interface, latency and cost metering | Demonstrates gateway, caching and cost attribution without contracts |
| OIDC + org entitlements | Header-based dev identities with roles | Keeps SoD/four-eyes logic real and testable |

Swapping any of these is a provider/config change, not a redesign — which is the point of the
architecture.
