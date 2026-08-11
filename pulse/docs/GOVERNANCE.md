# PULSE Governance & Agent Oversight

Implements the Agentic Oversight Framework (AOF) as platform primitives, extended with the model
risk management (SR 11-7), fair-lending (ECOA/Reg B) and AI-failure-surface concerns the
blind-spots memo flags as missing.

## 1. Automated Resolution Pathways (ARPs)

An agent is never deployed as "an agent". It is deployed as an **ARP**: a versioned record of

```yaml
arp_id: kyb-mismatch-triage
version: 3
task: "Resolve step-up KYB reviews where registry and applicant data disagree"
sop_refs: [POL-KYB-002 v4, POL-CIP-001 v7]        # citations into the knowledge corpus
data_contract:                                     # undeclared access is denied
  - entity.resolved_profile
  - facts.registry.*
  - screening.hits
  - documents.type in [incorporation, ownership]
success_criteria:
  agreement_rate: ">= 0.97"
  severity_1_miss: "== 0"
  max_p95_latency_s: 60
autonomy_tier: suggest                             # shadow | suggest | four_eyes | auto_bounded
permitted_recommendations: [approve, decline, escalate, request_information]
kill_switch: enabled
```

The ARP registry is the single place autonomy is granted or revoked. Changing a tier is a config
change with an approval record — never a code deploy.

## 2. The six AOF processes → platform primitives

| AOF process | PULSE primitive |
| --- | --- |
| 1 · Defined ARPs | `arps` registry + versioning; SOPs sourced from the versioned knowledge corpus, so an ARP is pinned to the policy version it was validated against |
| 2 · Data collection & preparation | ARP `data_contract` enforced at runtime; every input carries source, confidence, freshness |
| 3 · Decision & presentation | Agent run produces `recommendation`, `rationale`, `citations`, `decision_path`, `confidence`; a human disposes |
| 4 · Comprehensive audit trail | One hash-chained event log: inputs, retrievals, models/rules consulted, rationale, human disposition, timestamps, comments |
| 5 · Governance structure | Roles map to 3 lines of defence; 1LoD disposes, 2LoD owns thresholds and validation, 3LoD consumes examiner export |
| 6 · Explainability | Feature attribution, decision tracing, counterfactuals, threshold sensitivity, adverse-action reason codes |

## 3. Autonomy ladder and graduation

| Tier | Runs | Surfaces | Acts | Gate to enter |
| --- | --- | --- | --- | --- |
| `shadow` | yes | no | no | ARP registered, backtest passed on historical cases |
| `suggest` | yes | yes | no | ≥ 500 shadow cases, agreement ≥ 95 %, zero severity-1 misses |
| `four_eyes` | yes | yes | on 2nd human approval | agreement ≥ 97 % sustained 90 days, 2LoD sign-off |
| `auto_bounded` | yes | yes | alone, inside declared bounds | risk committee sign-off, kill switch drill passed, materiality below threshold, action reversible |

**Permanent ceilings.** Credit decisions, adverse actions, terminations, SAR filing and anything
irreversible cannot exceed `four_eyes`. Enforced in `materiality`, not left to ARP config.

**Automatic demotion.** Agreement rate below the ARP's floor over a rolling window, a drift alarm,
or a severity-1 miss demotes the ARP one tier and raises a 2LoD task. Demotion is automatic;
promotion never is.

## 4. Four eyes

Segregation of duties is enforced on identity, not intent:

- the human who disposes cannot be the human who created the case or supplied the evidence;
- for `four_eyes` actions, approver ≠ recommender ≠ requester;
- entitlements are scoped (segment, region, book) and recertified;
- every disposition records reviewer, timestamp, comment and the exact recommendation state seen.

## 5. Model risk management (SR 11-7)

| Requirement | Implementation |
| --- | --- |
| Inventory | Every model/rule/ARP registered with owner, version, purpose, validation status |
| Development documentation | Stored with the version; retrievable by decision |
| Independent validation | 2LoD validation record required before tier > shadow |
| Ongoing monitoring | Drift on inputs and outputs, agreement rate, stability, alert precision, with defined thresholds and owners |
| Champion/challenger | Challenger runs in shadow on live traffic; promotion requires measured lift |
| Change management | Version pinning; any decision replayable against the exact model + policy version in effect |

## 6. Fair lending & adverse action (ECOA / Reg B, FCRA where applicable)

- Every credit-adjacent decision emits **reason codes** ranked by contribution, mapped to
  human-readable adverse-action language.
- Prohibited-basis proxies are excluded from feature sets by policy and tested for by
  disparate-impact monitoring on protected-class proxies held only in the governance store.
- Counterfactuals ("what would have changed the outcome") are generated at decision time, not
  reconstructed later.
- Notices are generated from the decision record, so notice and decision cannot diverge.

## 7. Audit trail

Append-only, hash-chained:

```
event.hash = sha256(prev_hash || actor || action || subject || payload_canonical_json || ts)
```

- `GET /audit/verify` recomputes the chain and reports the first divergence.
- `GET /audit/export?entity_id=…` produces an examiner-ready pack: every fact with provenance,
  every retrieval, every rule and model version, every recommendation and disposition, in order.
- Retention 7 years; legal hold blocks disposal; disposal itself is an audited event.

## 8. AI failure surface (absent from the source portfolio — treated as first-class)

| Threat | Control |
| --- | --- |
| Prompt injection via merchant-supplied documents/websites | Untrusted content is retrieved as data, never into a tool-calling context; tool allow-lists per ARP; injected-instruction detection with quarantine |
| Hallucinated policy | Retrieval-only composition, mandatory citations, grounding threshold, refusal path, eval regression gate in CI |
| Model/vendor outage | Fallback to rules + human queue; degraded mode is a logged, alarmed state, never silent |
| Runaway automation | Rate limits and spend caps per ARP; kill switch at ARP, capability and platform level; documented blast radius |
| Data exfiltration through inference | No PII in prompts beyond ARP data contract; tokenised identifiers; egress logging |
| Red teaming | Quarterly adversarial suite per ARP (injection, evasion, synthetic identity, ownership obfuscation); findings block promotion |

## 9. Roles

| Role | Rights |
| --- | --- |
| `analyst` | Work cases, accept/reject recommendations within scope |
| `senior_analyst` | Four-eyes approver, exception requests |
| `policy_owner` | Author/publish knowledge + policy versions |
| `model_risk` (2LoD) | Validate ARPs, set thresholds, force demotion |
| `auditor` (3LoD) | Read-only everything, export |
| `admin` | Entitlements, kill switch, residency config |
