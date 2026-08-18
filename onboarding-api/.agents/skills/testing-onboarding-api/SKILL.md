---
name: testing-onboarding-api
description: How to run and end-to-end test the NestJS/Prisma merchant onboarding API (onboarding-api) as an HTTP API, including seeding credentials, sandbox scenario markers, and how to reach states (micro-deposits, declines) that the API does not expose directly.
---

# Testing `onboarding-api` (merchant onboarding REST API)

Backend-only service; there is no UI, so test it with curl/HTTP and do not record a screen session.

## Bring the environment up

```bash
cd onboarding-api
npm run db:up                 # postgres:16-alpine in Docker, container onboarding-api-postgres, host port 5433
cp .env.example .env          # .env is gitignored; defaults point at :5433
npx prisma migrate deploy     # idempotent
npm run build && npm run start:prod   # API on http://localhost:3000/v1, Swagger UI /v1/docs, spec /v1/docs-json
npm run seed                  # prints admin/operator/viewer API keys ONCE (stored only as sha256 hashes)
```

Keys look like `sk_sandbox_...`. Auth header is `X-API-Key: <key>`; a JWT from
`POST /v1/oauth/token` (`grant_type=client_credentials`, `client_id=pt_sandbox`,
`client_secret=<any API key>`) works as `Authorization: Bearer <jwt>`.
Re-running `npm run seed` is safe — it upserts the partner and adds new keys, so you can always
mint fresh credentials if you lost the printed ones.

Scopes: viewer=`read`, operator=`read write`, admin=`read write admin`. Admin-only routes:
`activate`, `suspend`, `audit-logs`, `manual-decision`.

## ID prefixes (useful when scraping responses)

`mer_`, `owner_`, `ba_`, `ver_`, `risk_`, `uw_`, `log_`, `doc_`, `wh_`, `pt_`, `ak_`.
Note merchants are `mer_...`, owners are `owner_...` — don't assume symmetry.

## Golden path (US company)

`POST /v1/merchants` → `POST /v1/merchants/{id}/business-verification` →
`POST /v1/merchants/{id}/owners` + `POST /v1/verify/identity` →
`POST /v1/merchants/{id}/bank-accounts` (US: routing `021000021`, 4–17 digit account) →
`GET /v1/merchants/{id}/status` (expect `pending_steps: []`) → `POST /v1/risk/assess` →
`POST /v1/underwriting/submit` → `POST /v1/merchants/{id}/activate` (admin) →
`GET /v1/merchants/{id}/audit-logs` (admin).

Deterministic expectations that make good assertions: clean US company with MCC 5734,
volume 50000, incorporation 2015 → risk_score 20 / level `low`; underwriting `approved`,
`pricing_tier: preferred`, limits daily 5000 / monthly 100000 / ticket 2500.

## Sandbox scenario markers (case-insensitive substrings)

- `sanctioned` in legal name or owner name → verification `failed`, `sanctions_screening_hit`,
  risk level `prohibited`, underwriting `declined`.
- `mismatch` in a name → `partial_match` checks and lower match scores.
- bank `verification_method: micro_deposits` → verification `in_progress` + `next_action:
  confirm_micro_deposits`.

## States the API will not hand you directly

- **Underwriting is gated on onboarding**: `POST /v1/underwriting/submit` with the default
  `underwriting_type: "automated"` returns 409 `onboarding_incomplete` while any step is pending.
  A sanctions hit bypasses that gate (its steps can never complete) and returns `declined`;
  `{"underwriting_type": "manual"}` skips the gate for any merchant.
- **Micro-deposit amounts are never returned** (only `micro_deposit_count`). Read them from the DB:
  `docker exec onboarding-api-postgres psql -U onboarding -d onboarding -t -A -c \
   "select micro_deposit_amounts from bank_accounts where id='ba_...';"`
  Prisma models map to snake_case tables (`merchants`, `bank_accounts`, `audit_logs`, ...), so quoted
  camelCase table names will fail.
- Submitting wrong amounts marks the account `failed` but keeps the amounts, so a retry with the
  correct amounts still succeeds.

## Invariants worth re-asserting

- Every response error is the `{type, code, message, request_id}` envelope, including framework
  failures (unmatched route, malformed JSON body); `request_id` always starts with `req_`.
- `audit_logs.request_id` matches the `X-Request-Id` of the call that produced the row.
- Re-verifying a bank account never destroys pending `micro_deposit_amounts`, so a failed
  confirmation can be retried with the correct amounts.

## Repo checks

`npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` (e2e needs Postgres up and
hits the real DB, so run it with the DB container healthy).
