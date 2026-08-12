# PULSE — Risk & Compliance Intelligence Platform · Megaplan

**Status:** proposal + working reference implementation in this repo
**Inputs:** Pulse Northstar / Why Pulse, Pulse Architecture, Pulse Path Forward, Pulse use-case
inventory (129 use cases), R&C Portfolio Blind-Spots memo, Credit & Risk Engineering strategy,
The Agentic Oversight Framework (Sardine et al.)

---

## 1. The bet

The Northstar decks and the blind-spots memo agree on the diagnosis but not on the sequencing.
The use-case inventory is 129 items deep and is, read literally, a backlog of tools. The memo's
verdict is the one to build against:

> Sequence the spine before the surface.

So PULSE is built as **three platform bets first**, and the 129 use cases become plug-ins on top:

| Bet | What it is | Why first |
| --- | --- | --- |
| **A · Shared intelligence substrate** | Canonical merchant/entity model, entity resolution, knowledge + policy corpus with versioning, entity & ownership graph, feature/signal store, one decision + agent audit log | De-duplicates data work listed 129 times; makes every later use case cheaper |
| **B · Governance & agent oversight as a product** | Automated Resolution Pathways (ARPs), shadow mode, four-eyes, scoped autonomy, evals/backtests, drift, explainability, adverse-action reasons, examiner-ready export, kill switch | Four+ agentic use cases otherwise ship four inconsistent control regimes; SR 11-7 / ECOA exposure is the fastest path to a finding |
| **C · Perpetual + real-time monitoring** | Continuous KYC/screening refresh, behavioural & business-model drift, portfolio surveillance, transaction-time signals, event-driven recompute | Most realised loss and enforcement exposure happens *after* boarding — where the inventory is thinnest |

**Design invariants** (every capability must satisfy these or it does not ship):

1. **Grounded or silent.** No answer without a citation to a versioned knowledge object or a
   resolved fact. Refusal is a valid, logged outcome.
2. **Risk is a state, not a snapshot.** Every score carries `as_of`, inputs, and a recompute
   trigger. Point-in-time-only capabilities are rejected at design review.
3. **Entity-first, not application-first.** The unit of analysis is the resolved entity and its
   network, never the application record.
4. **One audit spine.** Every machine and human action lands in a single append-only,
   hash-chained decision log. No per-use-case audit trails.
5. **Autonomy is earned.** Every agent starts in shadow, graduates by measured agreement rate
   against human outcomes, and can be demoted or killed by config without a release.
6. **Policy as code, versioned.** The rule in effect at any past date is retrievable and
   replayable.

---

## 2. Target architecture

Three pillars from the Pulse Architecture deck, made concrete. Full detail:
[ARCHITECTURE.md](./ARCHITECTURE.md).

```
                       ENGAGEMENT LAYER  (consumption surfaces)
   Analyst console · Merchant portal · Sales tools · Case mgmt · Comms · Partner console · APIs
                                        │  ask / act
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                      CONTEXTUAL LAYER — the Intelligence Layer                       │
│                                                                                      │
│  KNOW                          DETECT                        ACT                     │
│  ─ Grounded policy Q&A         ─ Materiality assessment      ─ Agent layer (ARPs)     │
│  ─ True merchant identity      ─ Scoring & models            ─ Workflows / tasks      │
│  ─ KYB & identity verify       ─ Drift & anomaly             ─ Notices & RFI          │
│  ─ UBO graph (3 hops)          ─ Peer-cohort comparison      ─ Limits / holds         │
│  ─ Network / link analysis     ─ Perpetual monitors          ─ Straight-through paths  │
│  ─ Merchant 360 + history      ─ Alert triage & severity     ─ Human-in-the-loop gates │
│                                                                                      │
│  Knowledge graph · semantic layer · RAG retrieval · memory · policy-as-code · rules   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  GOVERNANCE SPINE  — ARP registry · autonomy tiers · four-eyes · evals · drift ·      │
│                      explainability · hash-chained audit · kill switch · residency    │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                 DATA LAYER                                            │
│  Entity resolution · CRM/MDM masters · 3rd-party gateway (registry, sanctions, media, │
│  bureau) · document & evidence store · event fabric · data quality, lineage, PII      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Service decomposition

| Service | Owns | Key interfaces |
| --- | --- | --- |
| `knowledge` | Policy/regulation/scheme corpus, chunking, embeddings, versioning, effective-dating, grounded Q&A | `POST /knowledge/ask`, `GET /knowledge/documents/{id}/versions` |
| `entity` | Canonical entity + merchant records, entity resolution, KYB verification, UBO graph, link analysis | `POST /entities/resolve`, `GET /entities/{id}/ubo`, `GET /entities/{id}/network` |
| `screening` | Sanctions/PEP/watchlist/adverse-media matching, continuous re-screening | `POST /screening/run`, `GET /screening/hits` |
| `decision` | Policy-as-code rules engine, risk scoring, materiality, limits/reserve maths, adverse-action reasons | `POST /decisions/evaluate`, `GET /decisions/{id}/explain` |
| `monitoring` | Monitor registry, cadence + event triggers, drift detection, alert generation, peer cohorts | `POST /monitoring/run`, `GET /alerts` |
| `agents` | ARP registry, agent runs, shadow mode, recommendations, four-eyes queue, evals, kill switch | `POST /agents/{arp}/run`, `POST /agent-runs/{id}/review` |
| `cases` | Case lifecycle, tasks, evidence packs, SLA/ageing, queue management | `POST /cases`, `POST /cases/{id}/transition` |
| `audit` | Append-only hash-chained event log, examiner export, replay | `GET /audit/events`, `GET /audit/verify`, `GET /audit/export` |
| `gateway` | One governed path to third-party data: metering, caching, tiered calling, cost attribution | internal |

### Non-functional targets

| Concern | Target |
| --- | --- |
| Decision API latency | p50 < 120 ms, p99 < 400 ms (synchronous boarding path) |
| Real-time auth controls | p99 < 50 ms decision, fail-open with logged degradation |
| Perpetual refresh | sanctions re-screen ≤ 24 h of list change; identity/ownership ≤ 30 days or on event |
| Audit | 100 % of machine + human actions, tamper-evident, 7-year retention, examiner export < 1 h |
| Availability | 99.95 % boarding decision path; graceful degradation to human queue |
| Data residency | Per-tenant/region storage class, config-driven, no code fork per geography |
| Bureau/vendor cost | −35 % cost per boarding via dedupe, cache, tiered calling (Credit strategy Pillar 4) |
| Explainability | Every automated decision returns reason codes + feature attribution + counterfactual |

---

## 3. Governance model (from the Agentic Oversight Framework)

The AOF's six processes are implemented as platform primitives rather than per-use-case
paperwork. Detail: [GOVERNANCE.md](./GOVERNANCE.md).

1. **ARPs** — an agent is only ever deployed as (agent × task × SOP × data scope × success
   criteria). Registered, versioned, reviewable.
2. **Data preparation** — ARPs declare their data contract; the substrate provides validated,
   freshness-stamped inputs. Undeclared data access is denied.
3. **Decision & presentation** — the agent recommends; a human with the right entitlement
   disposes. Recommendation ships with rationale, citations and decision path.
4. **Audit trail** — hash-chained events: inputs, retrievals, models consulted, rationale,
   human disposition, timestamps.
5. **Governance structure** — three lines of defence mapped: 1LoD operates ARPs, 2LoD owns
   thresholds/validation, 3LoD audits via the same export.
6. **Explainability** — feature attribution, decision tracing, counterfactuals, threshold
   sensitivity; ECOA-grade adverse-action reason codes for anything credit-adjacent.

**Autonomy ladder** (config, not code):

| Tier | Behaviour | Graduation gate |
| --- | --- | --- |
| `shadow` | Runs, logs, never surfaces | ≥ 500 cases, agreement ≥ 95 %, no severity-1 miss |
| `suggest` | Surfaces recommendation to analyst | agreement ≥ 97 %, review time reduction demonstrated |
| `four_eyes` | Acts on second human approval | stable 90 days, 2LoD sign-off |
| `auto_bounded` | Acts alone inside declared bounds (low materiality, reversible) | risk-committee sign-off, kill switch tested |

Anything that is irreversible, adverse to the merchant, or credit-decisioning stays at
`four_eyes` or below — permanently.

---

## 4. Use-case portfolio: how the 129 map onto the spine

Machine-readable inventory: [`data/use_cases.csv`](../data/use_cases.csv) (129 rows, extracted
from the source deck). Distribution by domain:

| Domain | Count | Domain | Count |
| --- | --- | --- | --- |
| Post-Boarding | 20 | Termination | 12 |
| Knowledge | 18 | Compliance | 9 |
| Platform Services | 15 | Intake | 8 |
| Transaction Monitoring | 13 | Future (monetisation) | 8 |
| Credit | 12 | Boarding | 7 |
| | | Partner Oversight | 7 |

Sequencing rule: a use case is only scheduled once the substrate primitives it needs exist.
That collapses 129 items into ~14 primitives plus configuration.

| Primitive (build once) | Use cases it unlocks |
| --- | --- |
| Versioned knowledge corpus + grounded Q&A | UC 1–7, 11, 91–92, 201, 205–211 (Knowledge, 18) |
| Entity resolution + confidence | UC 203, 300, and every merchant-keyed use case |
| UBO graph + link analysis | UC 301, 41, 66, 97, 63 (relational risk) |
| KYB / identity / screening | UC 302–304, 306, 312 |
| Classification engine | UC 6, 14, 19, 20, 71 |
| Policy-as-code rules + thresholds registry | UC 200, 22, 26, 34, 45, 48–50, 316 |
| Scoring + materiality + peer cohorts | UC 15, 32, 52–55, 58, 110–115 |
| Monitor registry (cadence + event) | UC 17, 18, 23, 24, 28, 212, 306 |
| Case + task + evidence pack | UC 5, 25, 30, 117, 66 |
| Document generation | UC 2, 16, 43, 46, 53, 62 |
| RFI / unified request orchestration | UC 21, 47, 70, 57 |
| Agent + ARP framework | UC 73–75, 87, 111–116 |
| Third-party gateway + cost mgmt | UC 76–77, 107, 108 |
| Partner oversight feeds + scoring | UC 88–96 |

The eight "KNOW" use cases the decks name (true merchant identification, KYB, UBO graph,
network/link analysis, grounded policy Q&A, regulatory/network event tracking, merchant history
walkthrough, Merchant 360) are exactly the substrate's read surface — which is why they are
Phase 1, with **grounded policy Q&A as the first use case** (per Path Forward).

---

## 5. Roadmap

Sizing note: phases are expressed in engineering-team-quarters for a ~4-team org shaped like the
Credit & Risk strategy doc (Decisioning Platform, Model/MLOps, Monitoring & Surveillance,
Data & Bureau Integration) plus one Knowledge/Intelligence team.

### Phase 0 — Foundations (Q1)
- Canonical data model + event fabric + document/evidence store; PII tokenisation at ingest.
- Audit spine (hash-chained) and entitlements/SoD from day one — retrofitting audit is the
  classic failure.
- Third-party gateway with metering/caching (immediately harvests bureau-cost savings).
- **Exit:** every write is audited; one governed path to external data; masters populated.

### Phase 1 — KNOW (Q1–Q2) · *the eight KNOW use cases*
- Knowledge corpus: ingestion, chunking, effective-dated versioning, grounded Q&A with
  citations + refusal. **First use case.**
- Entity resolution with confidence scores; Merchant 360; history walkthrough.
- KYB + identity verification; UBO graph to 3 hops; sanctions/PEP/adverse media; link analysis
  incl. previously off-boarded actors.
- **Exit:** an analyst can answer "who is this, how are they connected, and what do our policies
  require?" in one place, with citations. Baseline: analyst hours/case, time-to-decision.

### Phase 2 — Governance spine + DETECT (Q2–Q3)
- ARP registry, shadow mode, four-eyes queue, evals/backtests, drift, explainability,
  adverse-action reason codes, examiner export, kill switch.
- Policy-as-code rules + thresholds registry; risk scoring with materiality; peer cohorts.
- Perpetual monitors: continuous re-screening, business-model drift, review cadence.
- **Exit:** first ARP graduates shadow → suggest with measured agreement; risk is recomputed
  continuously, not at boarding only.

### Phase 3 — ACT (Q3–Q4)
- Case/task orchestration, RFI orchestration, document + notice generation, auto-boarding inside
  pre-set limits, reserve/limit engine, holds and velocity caps.
- Transaction monitoring: canonical transaction model, multi-source detection, alert triage and
  severity routing, outcome labelling → model feedback.
- **Exit:** straight-through processing for low-materiality flows; measured loss-avoided.

### Phase 4 — Scale & monetise (Y2)
- Partner oversight (ISO/payfac/sub-merchant), multi-geography configuration, negative-entity
  consortium, risk-scoring API, embedded partner console, peer benchmarking.
- **Exit:** capabilities consumed externally; network effects on the negative file.

### Sequencing anti-patterns to refuse
- Shipping any agentic use case before the ARP spine (creates a parallel control regime).
- Shipping a credit or adverse decision without reason codes and counterfactuals.
- Any "phase 2 will add continuous monitoring" plan — perpetual is a Phase 1/2 property of the
  scoring contract, not a later feature.
- Per-geography forks. Geography is configuration.

---

## 6. Measurement

Instrument on outcome dollars, not handling time alone (blind-spots memo).

| Layer | Metric | Baseline → target |
| --- | --- | --- |
| Merchant | Time to boarding decision; documents requested more than once | weeks → hours; > 0 → 0 |
| Analyst | Hours per case; % of case time spent finding vs judging | −40 %; invert the ratio |
| Detection | Loss avoided (\$); alert precision; % relational risk found only by graph | new baselines |
| Perpetual | Median staleness of identity/ownership/screening state | < 30 d / < 24 h |
| Agentic | Agreement rate vs human; queue resolution rate; escalation rate; cost per decision | KYC-type ARPs > 95 % agreement (AOF reports 98 % resolution; sanctions/media ~55 %) |
| Governance | % decisions with complete audit chain; examiner export time; open model findings | 100 %; < 1 h; 0 overdue |
| FinOps | Vendor cost per boarding; % answered by own models before vendor call | −35 %; rising |

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Spine work is invisible to stakeholders; pressure to ship surfaces | Phase 1 ships a visible analyst surface (Merchant 360 + grounded Q&A) on top of the spine, not after it |
| Grounded Q&A hallucinates policy | Retrieval-only answers, mandatory citations, refusal path, eval set with regression gate |
| Entity resolution false merges | Confidence bands, human review above materiality threshold, reversible merges with full lineage |
| Agent autonomy creep | Autonomy tiers in config with committee gates; kill switch tested quarterly |
| Prompt injection / model failure (unaddressed in source portfolio) | Untrusted content quarantined from tool-calling context, allow-listed tools, red-team suite, fallback to human queue |
| Vendor lock-in on knowledge/LLM | Provider-pluggable inference; retrieval index owned in-house |
| Multi-jurisdiction divergence | Policy-as-code with jurisdiction predicates; residency config |

---

## 8. What this repo contains

A working reference implementation of the spine and the eight KNOW use cases, plus the
governance spine and perpetual monitoring — enough to demonstrate the invariants above end to
end on synthetic data. See [../README.md](../README.md) for how to run it, and
[ARCHITECTURE.md](./ARCHITECTURE.md) for how the code maps to the target architecture.

It is deliberately **not** a production system: third-party providers (registry, sanctions,
media, bureau) are simulated behind the same interfaces production adapters would implement, and
inference defaults to a local deterministic retrieval engine so the platform runs with no
external keys.
