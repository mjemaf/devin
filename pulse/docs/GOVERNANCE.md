# PULSE Governance & AI Access Spines

The Technical Architecture makes governance a **spine**, not a per-use-case obligation: nothing
reaches a model, a source system or a merchant except through it. This document specifies both
cross-cutting spines and the code that enforces them.

- Governance spine — PLS-70 audit & evidence ledger, PLS-71 MRM registry, PLS-72 ARP registry &
  four-eyes, PLS-73 evaluation/backtest/drift, PLS-74 explainability & adverse action, PLS-75
  entitlements, access & segregation of duties.
- AI access spine — PLS-80 model gateway, PLS-81 agent & skill registry, PLS-82 context assembly,
  PLS-83 cost management & metering, PLS-84 sandbox & safe testing, PLS-85 experimentation.

It also implements the Agentic Oversight Framework (AOF) as platform primitives, extended with
model risk management (SR 11-7), fair lending (ECOA / Reg B) and the AI failure surface the
blind-spots memo flags as missing.

## 1. Automated Resolution Pathways (ARPs)

An agent is never deployed as "an agent". It is deployed as a versioned ARP:

```yaml
arp_id: kyb-mismatch-triage
version: 3
task: "Resolve step-up KYB reviews where registry and applicant data disagree"
sop_refs: [POL-KYB-002 v4, POL-CIP-001 v7]        # citations into the approved corpus
data_contract:                                     # undeclared access is denied
  - entity.resolved_profile
  - facts.registry.*
  - screening.hits
  - documents.type in [incorporation, ownership]
success_criteria:
  agreement_rate: ">= 0.97"
  severity_1_miss: "== 0"
  max_p95_latency_s: 60
autonomy_tier: suggest          # persisted: shadow | suggest | four_eyes | auto_bounded
autonomy_ceiling: four_eyes     # a ceiling the tier can never exceed
permitted_recommendations: [approve, decline, escalate, request_information]
kill_switch: enabled
```

The registry is the single place autonomy is granted or revoked. Changing a tier is configuration
with an approval record, never a deploy (P8).

## 2. Autonomy ladder

Canonical naming follows the Technical Architecture; persisted values are retained for API and
data compatibility (`agents.CANONICAL_TIER`).

| Canonical | Persisted | Runs | Surfaces | Acts | Gate to enter |
| --- | --- | --- | --- | --- | --- |
| shadow | `shadow` | yes | no | no | ARP registered, backtest passed on historical cases |
| copilot | `suggest` | yes | yes | no | ≥ 500 shadow cases, agreement ≥ 95 %, zero severity-1 misses |
| assisted-auto | `four_eyes` | yes | yes | on a 2nd human approval | agreement ≥ 97 % sustained 90 days, 2LoD sign-off |
| bounded-auto | `auto_bounded` | yes | yes | alone, inside declared bounds | risk-committee sign-off, kill-switch drill passed, materiality below threshold, action reversible |

**Permanent ceilings.** Credit decisions, adverse actions, terminations, SAR filing and anything
irreversible cannot exceed assisted-auto. Enforced in materiality and the ARP ceiling, not left to
per-ARP configuration.

**Automatic demotion.** Agreement below the ARP floor over a rolling window, a material drift
band, or a severity-1 miss demotes the ARP one tier and raises a 2LoD task
(`POST /api/governance/drift/sweep`). Demotion is automatic; promotion never is.

**Kill switch.** Engaging it suspends the ARP; releasing it restores the tier that was in force
before the switch — an earned tier is never silently lost or silently regained.

## 3. The six AOF processes → platform primitives

| AOF process | PULSE primitive |
| --- | --- |
| 1 · Defined ARPs | ARP registry + versioning; SOPs sourced from the approved corpus, so an ARP is pinned to the policy version it was validated against |
| 2 · Data collection & preparation | ARP `data_contract` enforced by context assembly; every input carries source, confidence, freshness and classification |
| 3 · Decision & presentation | An agent run produces recommendation, rationale, citations, decision path, confidence; a human with the right entitlement disposes |
| 4 · Comprehensive audit trail | One hash-chained ledger: inputs, retrievals, models and rules consulted, rationale, human disposition, timestamps |
| 5 · Governance structure | Roles map to three lines of defence: 1LoD disposes, 2LoD owns thresholds and validation, 3LoD consumes the examiner export |
| 6 · Explainability | Reason codes, feature attribution, counterfactuals, threshold sensitivity, ECOA-grade adverse-action language |

## 4. Entitlements and segregation of duties (PLS-75)

Access is the **intersection** of role scopes and the requested scope — never the union — and is
further bounded by:

- **Classification ceiling.** `public < internal < confidential < restricted`; a caller cannot
  read above their ceiling, and the AI gateway refuses to send content above the route's ceiling.
- **Region / residency.** Region is part of the entitlement context, so residency is honoured by
  storage, retrieval and model routing rather than by forking the platform (C8, ADR-010).
- **Non-approving roles.** `analyst`, `auditor`, `system`, `service`, `agent` can never be the
  approver of a four-eyes request, regardless of scope grants.

Four eyes is enforced on identity, not intent: the approver cannot be the proposer, the approving
role must carry the right for that decision class, and a rationale is mandatory
(`services/four_eyes.py`, regression: `test_governance_spine.py`).

| Role | Rights |
| --- | --- |
| `analyst` | Work cases, accept/reject recommendations within scope |
| `senior_analyst` | Four-eyes approver, exception requests |
| `policy_owner` | Author and publish knowledge/policy versions |
| `model_risk` (2LoD) | Validate models and ARPs, set thresholds, force demotion |
| `auditor` (3LoD) | Read-only everything, export |
| `admin` | Entitlements, kill switch, residency configuration |

`GET /api/governance/entitlements` publishes role scopes, approval rights and the non-approving
roles, so the control set is inspectable rather than folklore.

## 5. Action broker (PLS-53) — no unbrokered effects

C5 means agents hold no source-system credentials. Every consequential effect goes through the
broker, which:

1. refuses an action whose decision class requires approval without a satisfied approval request;
2. records actor, actor type (human or agent), authority basis, rule reference and version;
3. issues a rollback token with an expiry for reversible actions, and marks irreversible ones as
   such up front;
4. on rollback, restores the state the action replaced (not a hardcoded default) and audits the
   reversal;
5. **reconciles** platform state against its own ledger, so a restricted or terminated merchant
   with no accounting brokered action is reported as suspected bypass.

## 6. Model risk management (SR 11-7, PLS-71)

| Requirement | Implementation |
| --- | --- |
| Inventory | Every model, rule pack and ARP registered with owner, version, purpose, validation status |
| Development documentation | Stored with the artefact version and retrievable from any decision |
| Independent validation | A 2LoD validation record is required before an artefact is runnable or a tier exceeds shadow |
| Ongoing monitoring | PSI-banded input/output drift, agreement rate, stability, alert precision, with owners and thresholds |
| Champion / challenger | Challenger runs in shadow on live traffic; promotion requires measured lift with a minimum observation count and a guardrail metric |
| Change management | Version pinning: `GET /api/decisions/{id}/replay` reproduces a decision against the exact feature, model and policy versions in force |

Feature definitions are versioned once and used online and offline, so a replay cannot silently
use a redefined feature (ADR-005).

## 7. Fair lending & adverse action (ECOA / Reg B, FCRA where applicable) — PLS-74

- Every credit-adjacent decision emits **reason codes** ranked by contribution and mapped to
  human-readable adverse-action language.
- Adverse-action generation **refuses** to produce a notice for an approval, and withholds
  internal model detail while still giving the specific principal reasons.
- Counterfactuals are generated at decision time, not reconstructed afterwards.
- Notices are generated from the decision record, so notice and decision cannot diverge.
- Prohibited-basis proxies are excluded from feature sets by policy and tested for by
  disparate-impact monitoring against proxies held only in the governance store.

## 8. Audit, evidence and replay (PLS-70)

Append-only and hash-chained:

```
event.hash = sha256(prev_hash || actor || action || subject || payload_canonical_json || ts)
```

- `GET /api/audit/verify` recomputes the chain and reports the first divergence.
- `GET /api/audit/replay-attestation` reports whether recorded decisions still replay to the same
  outcome from their pinned inputs — tamper evidence for the *decision*, not just the log.
- `GET /api/audit/export?entity_id=…` produces an examiner pack: every fact with provenance and
  freshness, every retrieval, every rule and model version, every recommendation and disposition,
  in order.
- Retention follows the longest applicable obligation (7–10 years by topic); legal hold blocks
  disposal, and disposal is itself an audited event.

Canonical events (C7) are durable, schema-validated and replayable, so evidence reconstruction
does not depend on a live consumer having been healthy at the time.

## 9. AI access spine (PLS-80 … PLS-85)

Every inference — grounded answers, agent reasoning, document drafting — passes the gateway. There
is no second path.

| Control | Behaviour |
| --- | --- |
| Routing & residency | Provider and region are configuration; the default provider is local and deterministic (ADR-006) |
| Classification guard | The gateway refuses to send content above the route's permitted classification |
| Context assembly (PLS-82) | Assembles only in-scope, in-force, freshness-stamped context; denied scopes are reported, never silently dropped |
| Citations | Responses carry citations; an uncitable answer is a refusal, logged with the gap |
| Cost metering (PLS-83) | Tokens, cost and provider recorded per invocation, attributed to entity/case; budget exhaustion refuses rather than overspends (`GET /api/ai/budget`) |
| Sandbox (PLS-84) | Synthetic fixtures and seeded data for safe testing; no production data in experimentation |
| Experimentation (PLS-85) | Registered experiments with a metric, a guardrail metric and a minimum observation count before a variant can win |

## 10. AI failure surface

| Threat | Control |
| --- | --- |
| Prompt injection via merchant-supplied documents or websites | Untrusted content is retrieved as data and never enters a tool-calling context; per-ARP tool allow-lists; injected-instruction detection with quarantine |
| Hallucinated policy | Retrieval-only composition over approved in-force versions, mandatory citations, grounding floor, logged refusal, eval regression gate in CI |
| Model or vendor outage | Fallback to rules plus the human queue; degraded mode is a logged, alarmed state that appears on the decision as `degraded_checks` |
| Runaway automation | Per-ARP rate limits and spend caps; kill switch at ARP, capability and platform level; documented blast radius |
| Data exfiltration through inference | No PII in prompts beyond the ARP data contract; tokenised identifiers; egress logged by the gateway |
| Unaccountable action | Nothing reaches an external system except through the broker, with a named accountable human (C6) |
| Red teaming | Adversarial suite per ARP (injection, evasion, synthetic identity, ownership obfuscation); findings block promotion |

## 11. What is enforced in code today

| Control | Module | Regression |
| --- | --- | --- |
| Entitlement intersection, classification ceiling, non-approving roles | `services/entitlements.py` | `test_governance_spine.py` |
| Four-eyes proposer ≠ approver, rationale required | `services/four_eyes.py` | `test_governance_spine.py` |
| Brokered actions, refusal without approval, rollback to prior state | `services/action_broker.py` | `test_governance_spine.py` |
| Model artefact runnable-state gating | `services/model_registry.py` | `test_governance_spine.py` |
| Gateway classification refusal, cost and citation logging | `services/ai_gateway.py` | `test_governance_spine.py` |
| Context assembly scope denial and freshness | `services/context_assembly.py` | `test_governance_spine.py` |
| Outcome labelling, drift-driven demotion | `services/outcomes.py`, `services/evaluation.py` | `test_act_spine.py` |
| Explanation, replay, adverse-action rules | `services/explainability.py` | `test_act_spine.py` |
| Requirement lifecycle and overdue escalation | `services/requirements.py` | `test_act_spine.py` |
| Bi-temporal facts, conflicts, event schema, replay idempotency | `services/provenance.py`, `services/events.py` | `test_platform_fabric.py` |
| Governance API surfaces | `api/routes.py` | `test_api_architecture.py` |
