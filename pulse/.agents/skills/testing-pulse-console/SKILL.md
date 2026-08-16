---
name: testing-pulse-console
description: How to run and end-to-end test the Pulse risk & compliance analyst console (FastAPI backend + Vite/React frontend), including seeded fixture data, hardcoded actor identities, the four-eyes approval path, and the API-only architecture/governance/AI/ACT spines that have no UI.
---

# Testing the Pulse analyst console

Synthetic reference implementation of a fintech risk & compliance platform.
No auth, no secrets, no external network calls.

## Devin Secrets Needed

None.

## Bring the stack up

```bash
# backend
cd <repo>/pulse/backend && source ../.venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 > /tmp/uvicorn.log 2>&1 &

# frontend (node_modules usually already present)
cd <repo>/pulse/frontend && npm run dev   # http://localhost:5173, proxies /api -> :8000
```

**Check the port Vite actually bound.** If a dev server from an earlier session still holds 5173,
Vite silently falls back to 5174 and you will test a stale build without noticing. Kill the old
process and confirm the banner says 5173 before testing:
`lsof -ti:5173 | xargs -r kill`.

Routes: `/dashboard`, `/merchants`, `/merchants/:entityId`, `/cases`, `/agents`, `/policy`, `/audit`.
API docs at `http://127.0.0.1:8000/docs`; everything is under `/api`.

**If you see sqlite `no such column` errors**, the checked-in DB is stale relative to the ORM
models. Delete it and restart uvicorn so the schema is recreated and reseeded:
`rm -f <repo>/pulse/backend/pulse.db`. Seeding is idempotent per fresh DB and writes ~147 audit
events; note that number before testing so you can assert the ledger grew.

## Seeded fixtures worth knowing

- Entity `29` "Halcyon Wellness Ltd" is the rich fixture: UBO gap, adverse media, negative-file
  hit, and a shared-address/director link to entity `1` "Meridian Wellness Ltd" (off-boarded).
  Its risk score is 78.43 and its boarding decision is `refer`.
- Actor identities are **hardcoded in the frontend**, not chosen in the UI:
  reviewer/case analyst `analyst@pulse.example`, approver `second.line@pulse.example`,
  kill-switch actor `risk.owner@pulse.example`.

## Exercising the four-eyes approval path (non-obvious)

The review queue only lists runs in `pending_review` / `pending_approval`. Reviewing a run does
**not** always produce an approvable run:

- `review()` sets `pending_approval` only when the run's mode is `four_eyes` **or** the chosen
  outcome is in `DUAL_AUTHORISATION` (= `materiality.NEVER_AUTOMATED`: `decline`, `terminate`,
  `file_sar`, `hold_funds`, `restrict`, credit decisions, ...).
- Otherwise it resolves immediately to `approved` (outcome matched the agent's recommendation) or
  `rejected` (it did not) and **disappears from the queue**. `rejected` means the analyst overrode
  the agent, not that the merchant was declined; the console now spells the disposition out in its
  notice ("analyst overrode the agent recommendation, run closed").

So: to reach the "Approve as second line" button, review a run whose recommendation is `decline`
with outcome `decline` (seeded run #2 / entity 14 works).

Because reviewer and approver are hardcoded to *different* identities, the UI cannot attempt a
same-person approval. Prove segregation out-of-band and expect HTTP 409:

```bash
curl -s -w '\n%{http_code}\n' -X POST \
  http://127.0.0.1:8000/api/agents/runs/<id>/approve \
  -H 'Content-Type: application/json' -d '{"approver":"analyst@pulse.example"}'
# 409 {"detail":"four-eyes breach: the approver must be a different person from the reviewer"}
```

## The console covers only part of the platform

The React app declares exactly **7 routes / 6 nav items** (`App.tsx`): Dashboard, Merchants,
Merchant 360, Cases & alerts, Agent review, Policy Q&A, Audit. Large parts of the backend have
**no UI at all** — the PLS component register, architecture/traceability/roadmap/ADRs, the event
fabric, the governance spine (entitlements, MRM, approvals, action broker, drift), the AI access
spine, ACT (requirements/outcomes/explain/replay) and the transaction plane. When asked to check
that "the new UI renders real values", first `git diff main...HEAD -- pulse/frontend/`; if it is
empty, the honest answer is that there is no surface, and those features must be tested by API.
There is also **no boarding UI** (nothing calls `POST /api/boarding/applications`), so "board the
application" cannot be done through the console — Halcyon is boarded by the seed.

## Testing the API-only spines

Enum values are validated server-side and are easy to guess wrong; read them first rather than
inventing them:

- Requirement types come from `GET /api/requirements` → `catalogue` (e.g. `ubo_declaration`);
  anything else is a 409 `unknown requirement type`.
- Outcome labels must be one of `confirmed`, `false_positive`, `explained` (400 otherwise).
- `POST /api/ai/context` scopes are entitlement scope patterns like `merchant.*`,
  `screening.hits`, `graph.*` — **not** page names. Unknown scopes are silently returned under
  `denied_scopes`, so a typo looks like an entitlement failure. Roles `risk_owner`, `second_line`,
  `auditor`, `system` hold `*`, so use `service` (or an unknown role) to prove scope denial.

**Every `/api/merchants/{id}/...` route keys on the *entity* id**, including `exposure`, which
translates to the internal merchant id itself and returns `no merchant for entity {id}` (404) for a
bare entity. Entity and merchant ids are offset, so an id that resolves under both names a
different business — prove routing with a discriminating id (entity `3` Northwind is merchant `2`,
while merchant `3` is Aurora Digital Goods) rather than one where the two happen to agree.

Governed action flow (the only path to a consequential action):
`POST /governance/approvals` → `POST /governance/approvals/{id}/decide` (distinct approver) →
`POST /governance/actions` quoting `approval_request_id` → `POST /governance/actions/{token}/rollback`.
Expected refusals: self-approval **403** (`EntitlementError`, note: *not* 409 like the agent-run
path), unapproved dual-auth action **409**, double rollback **409**.

## Policy Q&A grounding

`grounding_threshold` lives in `backend/app/config.py` (0.35). The retrieval score is the share of
the question's information content the best chunk covers, including query terms absent from the
corpus. Always test both a far-out-of-scope question ("Who won the 1998 World Cup?", score 0.00)
**and** a domain-adjacent one ("What licensing applies to crypto custody?", ~0.23) — both must
refuse, while genuinely covered questions score roughly 0.5-1.0 (the UBO question scores ~0.95 and
"What are the chargeback monitoring thresholds?" scores a full 1.00).

## Console / HTTP error sweep

A Playwright-over-CDP probe may exist at `/home/ubuntu/pwprobe/probe.mjs`:
`node probe.mjs /dashboard /merchants /agents ...`. Expect only React Router v7 future-flag
warnings; treat anything else as a finding. The dashboard is served by `/api/platform/overview`
(there is **no** `/api/dashboard` — probing it yields a red-herring 404). Check `/tmp/uvicorn.log`
for 4xx/5xx and remember the intentional four-eyes 409.

## Regression-prone areas (previously broken, now fixed — verify rather than assume)

- Dashboard "Peer cohorts": `scoring.cohort_stats` reports risk scores and chargeback rates as
  separate fields. Risk columns must read like scores (0-100), chargeback columns as percentages
  under ~3%.
- `agents.set_kill_switch` restores the tier held before engagement when released; engaging then
  releasing must return the ARP to e.g. `suggest`, not leave it on `shadow`.
- Promotion readiness renders the API's top-level metrics (`reviewed_runs`, `agreement_rate`,
  `p95_latency_ms`, `success_criteria`); an empty block means the shapes drifted again.
- Action rollback restores the merchant's **prior** lifecycle state, not a hardcoded `active`.
  Test it on a merchant that is *not* active, or the assertion proves nothing: Halcyon
  (entity 29 / merchant 17) seeds as `underwriting`, so restrict → rollback must return
  `underwriting`. `prior_state` is now returned on the serialised action as well as persisted.
- `GET /api/governance/drift` must return named features with numeric PSI (reading the wrong
  feature-vector key yields `baseline_n: 0`). The seed boards five merchants 8-27 days ago, so
  `recent_n: 5` and `merchant.chargeback_rate` / `merchant.volume_ratio` land in `material_shifts`;
  `recent_n: 0` means the recent cohort stopped being recent or stopped being seeded.
- `POST /api/governance/drift/sweep` demotes `monitoring-triage` (24 labelled outcomes, 70.83%
  agreement) to `shadow` and leaves `boarding-triage` (95.45%) alone. It is idempotent at the
  floor: a second sweep reports `breached: true` with `demoted_to: null`, no new tier-history
  entry, and releasing the kill switch afterwards restores `shadow`, not the pre-demotion tier.
  Promotion readiness reads *reviewed runs*, not labelled outcomes, so it shows 0.00% agreement
  for the same ARP the sweep just demoted at 70.83% — not a bug, but do not treat the two numbers
  as the same metric.

## What seeded data cannot exercise (do not fake these)

- Rollback-window expiry (24h) — needs clock manipulation.
- Non-reversible action rollback refusal: non-reversible actions get **no** `rollback_token`, so
  the "not reversible" branch is unreachable through the API.
- `POST /platform/events/replay` reports `matched: N, redelivered: 0` even with `dry_run: false`,
  because `_handled_event_ids` is an in-process set already populated by seeding. This is the
  documented idempotency contract, not a bug — but it means the re-dispatch path is not actually
  observed.
- Peer cohorts skip merchants with no `Score` row, and the five recent-intake merchants are seeded
  without one, so they are missing from cohorts until a monitoring sweep scores them. The sweep
  also opens five `EXCESSIVE_CHARGEBACKS` cases (all five breach the 0.9% `M-CB-003` threshold) and
  is what finally populates the cohort "Risk outliers" column.
- `GET /governance/actions` reports `bypass_suspected: true` on a fresh seed: seed-terminated
  Meridian (entity 1) has no brokered action accounting for its state. Expected, not a defect.
