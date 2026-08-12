# Pulse — risk & compliance intelligence platform

A synthetic reference implementation of the Pulse target architecture: one governed view of a
merchant and everyone connected to it, across onboarding, servicing, monitoring, credit and
off-boarding. Every answer is grounded in effective-dated policy, every fact carries provenance,
every decision carries a rule trace, and every machine recommendation runs under an explicit
autonomy tier with a human accountable for the outcome.

- [docs/MEGAPLAN.md](docs/MEGAPLAN.md) — build plan, scope and phasing
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, data contracts and how the code maps to them
- [docs/GOVERNANCE.md](docs/GOVERNANCE.md) — ARPs, autonomy ladder, permanent ceilings, evaluation gates

## What it does

| Capability | Where |
| --- | --- |
| Entity resolution with confidence bands and lineage | `backend/app/services/resolution.py` |
| Registry / KYB verification and mismatch detection | `backend/app/services/kyb.py` |
| UBO discovery and related-party traversal (3 hops) | `backend/app/services/graph.py` |
| Sanctions, PEP, watchlist, negative-file, adverse media screening | `backend/app/services/screening.py` |
| Grounded policy Q&A that refuses when unsupported | `backend/app/services/knowledge.py`, `retrieval.py` |
| Policy-as-code decisioning with reason codes and counterfactuals | `backend/app/services/policy.py`, `decisioning.py` |
| Transparent scoring, peer cohorts, materiality | `backend/app/services/scoring.py`, `materiality.py` |
| Event-driven and periodic monitoring | `backend/app/services/monitoring.py`, `events.py` |
| Governed agentic automation (shadow → suggest → four-eyes → bounded) | `backend/app/services/agents.py`, `arp_registry.py` |
| Tamper-evident audit chain and examiner exports | `backend/app/services/audit.py` |
| Analyst console (dashboard, Merchant 360, cases, agent review, policy Q&A, audit) | `frontend/` |

## Reference-implementation substitutions

SQLite instead of Postgres; in-process events instead of Kafka; deterministic local retrieval and
answer composition instead of a hosted LLM; synthetic registry, sanctions, adverse-media and bureau
fixtures instead of live vendors. No credentials or external services are required.

## Run it

Backend:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
cd backend && uvicorn app.main:app --reload --port 8000
```

The database schema is created and a synthetic portfolio is seeded on first start
(`PULSE_SEED_ON_STARTUP=false` to skip). API docs at `http://127.0.0.1:8000/docs`.

Console:

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173, proxies /api to :8000
```

Checks:

```bash
ruff check . && mypy && python -m pytest backend/tests -q
cd frontend && npm run typecheck && npm run lint && npm run build
```

## The seeded scenario

`Halcyon Wellness Ltd` applies from the same address as `Meridian Wellness Ltd`, a dissolved merchant
previously off-boarded for cause, sharing a director whose identity appears in variant forms and in an
internal negative file. Pulse keeps the two entities distinct, surfaces the link through the
related-party graph, and refers the application with `RELATED_TO_OFFBOARDED_ENTITY`,
`UBO_NOT_ESTABLISHED`, `ADVERSE_MEDIA` and thin-credit reason codes rather than deciding alone.
