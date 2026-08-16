---
name: testing-pulse-console
description: How to run and end-to-end test the Pulse risk & compliance analyst console (FastAPI backend + Vite/React frontend), including seeded fixture data, hardcoded actor identities, and how to exercise the four-eyes approval path.
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

Routes: `/dashboard`, `/merchants`, `/merchants/:entityId`, `/cases`, `/agents`, `/policy`, `/audit`.
API docs at `http://127.0.0.1:8000/docs`; everything is under `/api`.

**If you see sqlite `no such column` errors**, the checked-in DB is stale relative to the ORM
models. Delete it and restart uvicorn so the schema is recreated and reseeded:
`rm -f <repo>/pulse/backend/pulse.db`. Seeding is idempotent per fresh DB and writes ~85 audit
events; note that number before testing so you can assert the ledger grew.

## Seeded fixtures worth knowing

- Entity `24` "Halcyon Wellness Ltd" is the rich fixture: UBO gap, adverse media, negative-file
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
