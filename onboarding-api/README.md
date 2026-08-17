# Merchant Onboarding API

Unified onboarding platform for global SMB and micro-merchants: progressive onboarding, KYB/KYC,
bank account validation, risk scoring, automated and manual underwriting, signed webhooks and audit
logging behind a single versioned REST API.

Stack: NestJS (TypeScript), Prisma, PostgreSQL, Swagger, Pino, Jest/Supertest.

## Quick start

```bash
cd onboarding-api
cp .env.example .env
npm install
npm run db:up            # PostgreSQL 16 on localhost:5433 via docker compose
npx prisma migrate deploy
npm run seed             # creates the sandbox partner and prints its API keys once
npm run start:dev
```

- API: `http://localhost:3000/v1`
- Swagger UI: `http://localhost:3000/v1/docs` (JSON at `/v1/docs-json`)
- Health: `GET /v1/health`

`npm run seed` prints one admin, one operator and one viewer key. They are stored only as SHA-256
hashes, so copy them at that point — they cannot be recovered later.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by Prisma. |
| `PORT` | HTTP port (default `3000`). |
| `JWT_SECRET` | Signing key for OAuth 2.0 client-credentials access tokens. |
| `DOCUMENT_STORAGE_DIR` | Local directory for sandbox document storage (GCS bucket in production). |
| `WEBHOOK_TIMEOUT_MS` | Per-attempt webhook delivery timeout. |
| `RATE_LIMIT_PER_MINUTE` | Requests per minute per client. |

## Authentication

Three interchangeable credentials, all resolved to the same partner-scoped auth context:

```bash
curl -H "X-API-Key: sk_test_..." http://localhost:3000/v1/merchants
curl -H "Authorization: Bearer sk_test_..." http://localhost:3000/v1/merchants

curl -X POST http://localhost:3000/v1/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credentials","client_id":"pt_sandbox","client_secret":"sk_test_..."}'
# -> { "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600, "scope": "read write" }
```

Roles map onto scopes: `admin` → `read write admin`, `operator` → `read write`, `viewer` → `read`.
Read endpoints need `read`, mutations need `write`, and privileged operations (suspend, activate,
manual underwriting decisions, audit logs) need `admin`. Every merchant read and write is scoped to
the calling partner — another partner's merchant is a `404`, never a `403`.

## Onboarding flow

```bash
# 1. Application: returns the progressive onboarding checklist for the merchant's country
POST /v1/merchants
# 2. KYB: legal entity details, verified against the country's registries
POST /v1/merchants/{id}/business-verification
# 3. Beneficial owners, then KYC per owner
POST /v1/merchants/{id}/owners
POST /v1/verify/identity
# 4. Settlement account (structurally validated, then verified instantly or by micro-deposits)
POST /v1/merchants/{id}/bank-accounts
POST /v1/verify/bank-account/micro-deposits
# 5. Supporting documents
POST /v1/merchants/{id}/documents
# 6. Risk and underwriting
POST /v1/risk/assess
POST /v1/underwriting/submit
# 7. Go live
POST /v1/merchants/{id}/activate
```

`GET /v1/merchants/{id}/status` returns the merchant status, per-step state, outstanding required
actions, an estimated completion time, plus the latest risk and underwriting outcome.

Statuses progress `pending → pending_verification → under_review → approved/declined → active`, and
`suspended` for enforcement actions. Onboarding steps are country-aware: US merchants get
`tax_id_verification`, EU/UK merchants `psd2_sca_attestation`, Canada `fintrac_registration_check`,
Australia `austrac_reporting_enrolment`, and countries without a region profile get
`manual_compliance_review`. `GET /v1/supported-countries` lists the profiled countries; the
prohibited list (`IR`, `KP`, `SY`, `CU`) is rejected at application time.

Send an `Idempotency-Key` header on any mutation to make it safely retryable: an identical replay
returns the original response with `Idempotent-Replayed: true`, and reusing the key with a different
body is a `409`.

## Errors

Every failure uses the same envelope, with the `X-Request-Id` of the request echoed back:

```json
{
  "error": {
    "type": "validation_error",
    "code": "invalid_request_parameter",
    "message": "mcc must be a 4-digit merchant category code",
    "param": "mcc",
    "request_id": "req_9f2c1a"
  }
}
```

`type` is one of `validation_error`, `authentication_error`, `authorization_error`,
`not_found_error`, `conflict_error`, `rate_limit_error`, `api_error`.

## Sandbox behaviour

Verification providers are deterministic, so partners can script scenarios from the submitted data:

| Input | Result |
| --- | --- |
| Legal or owner name containing `sanctioned` | Screening hit → verification `failed`, risk `prohibited`, underwriting `declined` |
| Name containing `mismatch` | Partial match → verified with a lower match score |
| Missing registration number and tax ID | `business_not_found_in_registry` |
| `document_upload` identity check with no ID document | `government_id_document_missing` |
| Bank account with `verification_method: micro_deposits` | `in_progress` until the two amounts are confirmed |
| Structurally invalid account for the country | `bank_account_invalid` |

Account numbers are validated per region before storage: US ABA checksum, UK sort code, IBAN
(mod-97), Canadian transit/institution, Australian BSB.

## Webhooks

```bash
POST /v1/webhooks   # { "url": "https://partner.example.com/hooks", "events": ["merchant.created"] }
```

Deliveries are signed with the endpoint secret returned once at registration:

```
X-Webhook-Id: whd_...
X-Webhook-Timestamp: 1700000000
X-Webhook-Signature: v1=<hex hmac-sha256 of "<timestamp>.<raw body>">
```

Verify with a timing-safe comparison and reject stale timestamps. Failed deliveries are retried
three times with exponential backoff, and every attempt is queryable via
`GET /v1/webhooks/{id}/deliveries`.

## Data protection

- Bank account numbers are never persisted — only a deterministic token and the last four digits.
- Tax IDs are stored as a token plus last four; they are never returned or logged.
- API keys are stored as SHA-256 hashes; only the prefix is retained for identification.
- Documents are written under `<storage>/<partner>/<merchant>/<document>` with mode `0600` and a
  SHA-256 checksum in metadata.
- Request logs redact authorization headers, API keys and tax IDs.
- Sensitive business actions are written to an append-only audit log
  (`GET /v1/merchants/{id}/audit-logs`).

## Tests

```bash
npm run typecheck
npm run lint
npm test          # unit: risk scoring, underwriting rules, bank validation, crypto, onboarding steps
npm run test:e2e  # end-to-end against the docker database (creates and cleans its own partners)
```

The e2e suite boots the real application module and covers the full onboarding path, auth and scope
enforcement, partner isolation, validation envelopes, idempotency replay/conflict, signed webhook
delivery and document upload limits.

## Deployment (GCP)

- **Cloud Run** for the API container, min instances > 0 to avoid cold starts on webhook retries.
- **Cloud SQL for PostgreSQL** (private IP, automated backups, PITR) — run
  `prisma migrate deploy` as a release step.
- **Secret Manager** for `DATABASE_URL`, `JWT_SECRET` and provider credentials, mounted as env vars.
- **Cloud Storage** for merchant documents (CMEK, uniform bucket-level access, regional bucket
  matching the merchant's data-residency requirement).
- **Cloud Tasks** for webhook delivery and retry scheduling once volume outgrows in-process retries.
- **Cloud Logging/Monitoring** with the structured Pino output; alert on verification-provider error
  rate, underwriting queue depth and webhook failure rate.
- Data residency is reported per merchant in `compliance.data_residency`; run separate regional
  deployments (for example `europe-west1` for EU merchants) to honour it.
