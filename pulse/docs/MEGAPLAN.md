# PULSE — Risk & Compliance Intelligence Platform · Megaplan

**Status:** plan of record + working reference implementation in this repo
**Inputs:** PULSE Technical Architecture (current spec, supersedes the earlier Pulse Architecture
deck), Pulse Northstar / Why Pulse, Pulse Path Forward, Pulse use-case inventory (129 use cases),
R&C Portfolio Blind-Spots memo, Credit & Risk Engineering strategy, The Agentic Oversight
Framework

Companions: [ARCHITECTURE.md](./ARCHITECTURE.md) · [GOVERNANCE.md](./GOVERNANCE.md)

---

## 1. The bet

The use-case inventory is 129 items deep and reads, literally, as a backlog of tools. The
blind-spots memo's verdict is the one to build against:

> Sequence the spine before the surface.

The Technical Architecture makes that concrete: capability is organised as **KNOW → DETECT → ACT**
sitting on a **foundation data plane**, with two cross-cutting spines — **Governance** and **AI
Access** — that every capability must go through. The 129 use cases then become configuration on
top of ~48 registered components rather than 129 projects.

| Bet | What it is | Why first |
| --- | --- | --- |
| **A · Foundation + KNOW** | Bi-temporal fact substrate, entity resolution, approved knowledge/policy corpus, ownership graph, Merchant 360 | De-duplicates the data work implied 129 times; grounded answers are impossible without it |
| **B · The two spines** | Governance spine (audit ledger, MRM registry, ARP registry + four-eyes, evals/drift, explainability, entitlements) and AI access spine (model gateway, agent/skill registry, context assembly, cost metering, sandbox, experimentation) | Any agentic use case shipped before the spines ships its own control regime; SR 11-7 / ECOA exposure is the fastest route to a finding |
| **C · DETECT + perpetual monitoring** | Continuous screening refresh, ownership/business-model change, peer cohorts, transaction-time detection, event-driven recompute | Most realised loss and enforcement exposure happens *after* boarding — where the inventory is thinnest |
| **D · ACT under the spines** | ARP runtime, requirement orchestration, action broker with rollback, outcome/feedback loop | Automation is only safe once every effect is brokered, attributable and reversible |

### Design principles (P1–P10)

P1 grounded by default · P2 single master per entity with federated attribute ownership ·
P3 bi-temporal everything · P4 deterministic before probabilistic before paid · P5 composable
capability · P6 human accountability preserved · P7 event-driven by default · P8 configuration
over release · P9 observability as a build requirement · P10 reuse the approved estate.

### Non-negotiable commitments (C1–C8)

C1 citations with provenance and freshness on every answer, score and recommendation · C2 the
knowledge graph is a system of reference, never of record · C3 policy, rules, thresholds and facts
are versioned, retrievable and replayable · C4 deterministic → internal model → paid vendor · C5
agents hold no source-system credentials; access is brokered, scoped, logged · C6 every
consequential decision has a named, timestamped accountable human · C7 every state transition
publishes a canonical event · C8 PII is tokenised before storage and residency is configuration.

Every one of C1–C8 has regression coverage in `backend/tests/` (`test_platform_fabric.py`,
`test_governance_spine.py`, `test_act_spine.py`, `test_api_architecture.py`). A commitment without
a test is a slogan.

---

## 2. Target architecture in one view

```
                       ENGAGEMENT (PLS-60…65)
   Analyst workbench · Merchant portal · Partner console · Comms & task inbox · External APIs
                                        │ ask / act
┌───────────────────────────────────────▼──────────────────────────────────────────────┐
│  KNOW (PLS-20…27)          DETECT (PLS-30…42)           ACT (PLS-50…55)              │
│  knowledge base core       rules & decision engine      agent runtime / ARP executor  │
│  entity resolution         scoring & model serving      workflow binding              │
│  knowledge graph / UBO     materiality & triggers       outcome & feedback            │
│  semantic retrieval        signals & alerts             action broker                 │
│  policy-as-code            peer cohorts                 requirement orchestration     │
│  grounded answers          classification               document / adverse action     │
│  memory & case context     perpetual monitoring                                       │
│  Merchant 360              screening                                                  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  GOVERNANCE SPINE (PLS-70…75)   audit ledger · MRM registry · ARP registry & four-eyes │
│                                 evals/backtest/drift · explainability · entitlements  │
│  AI ACCESS SPINE  (PLS-80…85)   model gateway · agent & skill registry · context      │
│                                 assembly · cost metering · sandbox · experimentation  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  FOUNDATION (PLS-10…17)  ingestion · vendor gateway · document & evidence · event      │
│  fabric · data quality/lineage/provenance · feature store · transaction normalisation │
│  · reference & master data binding                                                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

48 components, each with an id, layer, horizon, delivery state and the modules that implement it.
The register is queryable (`GET /api/platform/components`) and honest by construction:

| State | Meaning | Count in this repo |
| --- | --- | --- |
| `implemented` | behaviour exists and is exercised by tests | 36 |
| `reference` | contract-shaped stand-in; production form is an adapter swap | 9 |
| `planned` | declared with owner and horizon, no code | 3 |

---

## 3. Governance model

Detail in [GOVERNANCE.md](./GOVERNANCE.md). The short form:

- **ARPs, not "agents".** An agent is only ever deployed as (agent × task × SOP × data scope ×
  success criteria × autonomy tier × ceiling), registered and versioned.
- **Autonomy ladder** — canonical naming from the Technical Architecture, with the persisted
  values kept for API/data compatibility:

  | Canonical | Persisted | Acts? |
  | --- | --- | --- |
  | shadow | `shadow` | no, logs only |
  | copilot | `suggest` | no, surfaces a recommendation |
  | assisted-auto | `four_eyes` | on a second human approval |
  | bounded-auto | `auto_bounded` | alone, inside declared bounds |

  Promotion is earned and gated; demotion is automatic on drift, agreement decay or a severity-1
  miss. Irreversible, adverse or credit-decisioning actions are permanently capped at
  assisted-auto.
- **Every effect is brokered.** No capability mutates the outside world directly: the action
  broker enforces approval, records authority basis, and issues a time-boxed rollback token that
  restores the state the action replaced.
- **Every decision is replayable.** `facts_relied` + `fact_provenance` + `model_versions` +
  policy version + `degraded_checks`, so `GET /api/decisions/{id}/replay` reconstructs the
  decision as it was made, not as the world is now.

---

## 4. Use-case portfolio: 129 → 48 components

Machine-readable inventory: [`data/use_cases.csv`](../data/use_cases.csv). Traceability is served
by the platform (`GET /api/platform/traceability`): every use case names the components it needs,
their delivery state, and what blocks it. Distribution by domain:

| Domain | Count | Domain | Count |
| --- | --- | --- | --- |
| Post-Boarding | 20 | Termination | 12 |
| Knowledge | 18 | Compliance | 9 |
| Platform Services | 15 | Intake | 8 |
| Transaction Monitoring | 13 | Future (monetisation) | 8 |
| Credit | 12 | Boarding | 7 |
| | | Partner Oversight | 7 |

Sequencing rule: a use case is scheduled only once the components it depends on are `implemented`
or `reference`. **Grounded policy Q&A is the first vertical** (per Path Forward) because it
exercises the full stack end to end — approved corpus, context assembly, AI gateway, citations,
refusal, audit — on the narrowest possible blast radius.

Monetisation surfaces (the 8 "Future" use cases, ADR-012) are deliberately deferred until
commercially specified; the internal contracts are versioned and metered now so they can be
exposed without re-architecting the API.

---

## 5. Roadmap (H0–H5)

Sizing is in delivery horizons, not calendar quarters, because the gating factor is component
readiness rather than headcount. `GET /api/platform/roadmap` reports delivered/total per horizon.

| Horizon | Theme | Exit criterion |
| --- | --- | --- |
| **H0** | Validation | Retrieval, entity resolution, audit ledger and policy store prove the spine on one narrow flow |
| **H1** | Foundation + grounded policy Q&A | Every write audited; one governed egress to external data; bi-temporal facts with provenance; grounded answer with citations *and* a working refusal path |
| **H2** | Grounded intelligence | Resolved entities, UBO to three hops, network/link analysis incl. previously off-boarded actors, Merchant 360, analyst workbench |
| **H3** | Detect + perpetual monitoring | Continuous re-screening and ownership/business-model change detection, feature store with one definition online and offline, peer cohorts, drift with automatic ARP demotion |
| **H4** | Act | ARP runtime under four-eyes, requirement orchestration, brokered actions with rollback, adverse-action notices generated from the decision record |
| **H5** | Scale + ecosystem | Partner oversight, multi-region residency as configuration, negative-file consortium, embedded/external API surface |

### Sequencing anti-patterns to refuse
- Any agentic use case before the governance and AI access spines (creates a parallel control
  regime that must later be unwound).
- Any credit or adverse decision without reason codes and counterfactuals generated at decision
  time.
- Any "phase 2 adds continuous monitoring" plan — perpetual is a property of the scoring contract.
- Any capability that reaches an external system without going through the broker or the gateway.
- Per-geography forks. Residency is configuration (ADR-010).

---

## 6. Measurement

Instrument on outcome dollars, not handling time alone (blind-spots memo).

| Layer | Metric | Baseline → target |
| --- | --- | --- |
| Merchant | Time to boarding decision; documents requested more than once | weeks → hours; > 0 → 0 |
| Analyst | Hours per case; % of case time finding vs judging | −40 %; invert the ratio |
| Detection | Loss avoided ($); alert precision; % relational risk found only by graph | new baselines |
| Perpetual | Median staleness of identity / ownership / screening state | < 30 d / < 24 h |
| Agentic | Agreement rate vs human; queue resolution; escalation rate; cost per decision | KYC-type ARPs > 95 % agreement |
| Governance | % decisions with a complete audit chain and replay attestation; examiner export time | 100 %; < 1 h |
| FinOps | Vendor cost per boarding; % answered before a paid call; AI spend per decision vs budget | −35 %; rising; within cap |
| Platform | NFR attainment against the published latency and availability targets | all paths inside target |

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Spine work is invisible; pressure to ship surfaces | H1/H2 ship a visible analyst surface *on* the spine, not after it |
| Grounded Q&A hallucinates policy | Retrieval-only composition over approved versions, mandatory citations, grounding floor, logged refusal, eval regression gate |
| Entity resolution false merges | Confidence bands, human review above a materiality threshold, reversible merges with full lineage |
| Autonomy creep | Tiers and ceilings in configuration with committee gates; automatic demotion on drift; kill switch drills |
| Prompt injection / model failure | Untrusted content never enters a tool-calling context; allow-listed tools per ARP; red-team suite; fallback to the human queue |
| Silent degradation | Stale or unavailable inputs surface as `degraded_checks` on the decision and as source-feed health, never as silence |
| Vendor lock-in on inference | All inference behind the AI gateway with a local default provider; retrieval index owned in-house |
| Multi-jurisdiction divergence | Policy-as-code with jurisdiction predicates; residency and region as entitlement context |
| Event-schema churn breaking consumers | Versioned topics, required-field schemas, dual-write windows, replayable log |

---

## 8. What this repo contains

A working reference implementation of the foundation, both spines, KNOW, DETECT and ACT — enough
to demonstrate C1–C8 end to end on synthetic data, plus the React analyst console. See
[../README.md](../README.md) to run it and [ARCHITECTURE.md](./ARCHITECTURE.md) for the code map.

It is deliberately **not** production: the event fabric is durable but in-process, vendor
providers are simulated behind production-shaped adapters, and inference defaults to a local
deterministic provider so the platform runs with no external keys. Those components are marked
`reference` in the register rather than described as finished.
