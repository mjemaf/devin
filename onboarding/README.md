# Onboarding API

Unified merchant onboarding for global SMB and micro-merchants. One API covers direct
REST integrations, embedded onboarding UI, white-label flows and marketplace/platform
onboarding: progressive intake, KYB/KYC verification, bank-account validation, risk
scoring, automated underwriting, and webhooks.

- API reference: [docs/api-reference.md](docs/api-reference.md)
- Integration guide (all four patterns): [docs/integration-guide.md](docs/integration-guide.md)
- Compliance and data protection: [docs/compliance.md](docs/compliance.md)
- Architecture and GCP deployment: [docs/architecture.md](docs/architecture.md)
- Live OpenAPI: `GET /docs` (Swagger UI) and `GET /docs/openapi.json`

## Stack

NestJS 10 / TypeScript 5.7 on Node 20, PostgreSQL 16 via Prisma 5.

## Local setup

```bash
cd onboarding
cp .env.example .env                 # local defaults work as-is
docker compose up -d postgres        # PostgreSQL 16 on :5432
npm install
npm run db:migrate:dev               # applies migrations
npm run db:seed                      # demo partner + full-scope test key (printed once)
npm run start:dev                    # http://localhost:3000, docs at /docs
```

Verify:

```bash
curl localhost:3000/readyz
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

`npm run test:e2e` runs against the database in `DATABASE_URL` and cleans up the
partners it creates.

## Quickstart

Provision a partner and key with the bootstrap admin key (`ADMIN_API_KEY`), then use the
returned secret as `X-Api-Key`:

```bash
PARTNER=$(curl -s localhost:3000/v1/partners -H "X-Api-Key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Platforms","integration_mode":"direct_api"}' | jq -r .id)

curl -s localhost:3000/v1/partners/$PARTNER/api-keys -H "X-Api-Key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"scopes":["merchants:read","merchants:write","verification:write","risk:write","underwriting:write","webhooks:write","analytics:read"],"role":"admin"}'
```

Then onboard a merchant — intake is deliberately small, and the response tells you the
country-specific steps that remain:

```bash
curl -s localhost:3000/v1/merchants -H "X-Api-Key: $KEY" \
  -H 'content-type: application/json' -H 'Idempotency-Key: onboard-1' \
  -d '{"business_type":"company","country":"US","email":"owner@acme.test",
       "phone":"+14155550123","business_name":"Acme Coffee LLC","mcc":"5812",
       "estimated_monthly_volume":45000}'
```

```json
{
  "merchant_id": "mer_...",
  "status": "pending",
  "onboarding_token": "eyJ...",
  "required_steps": ["business_verification", "bank_account_setup", "owner_verification"]
}
```

Full happy path: `business-verification` → `owners` → `bank-accounts` → `documents` →
`/v1/verify/*` → `/v1/risk/assess` → `/v1/underwriting/submit` → `activate`. See the
[integration guide](docs/integration-guide.md).

## Conventions

- All resource endpoints are versioned: `/v1/...`. Health probes are unversioned.
- Public identifiers are opaque and prefixed (`mer_`, `owner_`, `ba_`, `doc_`, `ver_`,
  `risk_`, `uw_`, `wh_`, `evt_`).
- Every response carries `X-Request-Id`; errors repeat it as `error.request_id`.
- Mutating requests accept `Idempotency-Key`; a repeat replays the stored response.
- Credentials: `X-Api-Key: <secret>`, `Authorization: Api-Key <secret>`, or
  `Authorization: Bearer <secret-or-session-JWT>`.

## Sandbox triggers

Verification runs against deterministic sandbox providers
(`VERIFICATION_PROVIDER_MODE=mock`), so every branch is reachable without a vendor:

| Input | Result |
| --- | --- |
| `legal_name` contains `TEST_KYB_NOT_FOUND` | KYB fails, `registry_not_found` |
| `legal_name` or owner surname contains `TEST_SANCTIONS` | sanctions hit, verification fails |
| owner `national_id_last4` = `0000` | identity verification fails |
| `routing_number` = `000000000` | bank account reported closed |
| `verification_method` = `micro_deposits` | stays `in_progress` until amounts are confirmed |
| `mcc` = `7995`, `6051`, `5967`, `4829` | prohibited category, underwriting declines |

## Configuration

See `.env.example`. Notable variables: `DATABASE_URL`, `ADMIN_API_KEY` (bootstrap
provisioning), `JWT_SECRET` / `JWT_TTL_SECONDS` (onboarding session tokens),
`DATA_ENCRYPTION_KEY` (32-byte hex, tokenises bank account numbers),
`DOCUMENT_STORAGE_DIR`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_TIMEOUT_MS`.

In production these come from Secret Manager, never from a checked-in file.
