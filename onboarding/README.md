# Unified Merchant Onboarding API

Backend MVP for a unified merchant onboarding platform: KYB/KYC verification, bank-account
validation, deterministic risk scoring, automated underwriting, and webhooks — behind a single
partner-scoped API. NestJS + Prisma + PostgreSQL. Verification runs against a local sandbox
provider, so the whole onboarding flow is exercisable without third-party credentials.

- API reference: [docs/api-reference.md](docs/api-reference.md)
- Interactive docs: `http://localhost:3000/docs` (Swagger) once the server is running.

## Local setup

PostgreSQL 14+ is required.

```bash
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER onboarding WITH PASSWORD 'onboarding' CREATEDB"
sudo -u postgres psql -c "CREATE DATABASE onboarding OWNER onboarding"
sudo -u postgres psql -c "CREATE DATABASE onboarding_test OWNER onboarding"
```

Or use the bundled compose file instead: `docker compose up -d`.

```bash
cd onboarding
npm install
cp .env.example .env          # tweak DATABASE_URL / JWT_SECRET if needed
npx prisma migrate deploy     # apply schema
npm run prisma:seed           # sandbox partner + API key
npm run start:dev
curl localhost:3000/v1/health # {"status":"ok","database":"reachable"}
```

`prisma migrate reset --force` recreates the schema and reseeds in one step.

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | HTTP port (default `3000`) |
| `JWT_SECRET` | Signs merchant-scoped onboarding tokens **and** derives the tokenization key for sensitive fields |
| `ONBOARDING_TOKEN_TTL` | Onboarding token lifetime in seconds |
| `STORAGE_DRIVER` / `STORAGE_LOCAL_DIR` | Document storage backend and local path |
| `RATE_LIMIT_PER_MINUTE` | Per-API-key request budget |
| `SEED_PARTNER_API_KEY` | Raw key the seed script hashes (only the hash and prefix are stored) |

`JWT_SECRET` is a stand-in for a KMS-managed key; rotating it invalidates existing tokens and makes
previously tokenized account numbers and tax IDs undecryptable.

## Authentication

Partner API key (server-to-server):

```bash
curl localhost:3000/v1/merchants \
  -H "Authorization: Bearer sk_sandbox_devin_local"   # or: -H "X-Api-Key: sk_sandbox_devin_local"
```

`POST /v1/merchants` also returns an `onboarding_token` — a short-lived JWT scoped to that single
merchant, for embedded/white-label clients that must not hold the partner key. Keys carry a role
(`admin`, `operator`, `viewer`) which expands to scopes (`merchants:read`, `merchants:write`,
`verification:write`, `risk:read`, `risk:write`, `underwriting:write`, `webhooks:write`).

Mutating requests accept `Idempotency-Key`: a repeat with the same payload replays the stored
response with `Idempotent-Replayed: true`; the same key with a different payload returns `409`.

## Golden path

`scripts/smoke.sh` walks the full flow against a running server (merchant → business verification →
owner + identity → bank account → document → risk → underwriting → status):

```bash
BASE=http://localhost:3000/v1 KEY=sk_sandbox_devin_local ./scripts/smoke.sh
```

## Sandbox provider

`SandboxVerificationProvider` implements the same `VerificationProvider` interface a real KYB/KYC
vendor would, with deterministic triggers:

| Input | Outcome |
| --- | --- |
| `legal_name` contains `FAIL` | `failed` |
| `legal_name` contains `REVIEW` | `pending` (manual review) |
| bank account ending `0000` | `failed` |
| anything else valid | `verified` |

Identity verification requires `consent: true`. Bank accounts verify instantly or via
micro-deposits (`POST /v1/merchants/{id}/bank-accounts/{ba}/confirm-micro-deposits`).

## Risk and underwriting

Risk scoring is deterministic and explainable: five weighted factors (industry 0.30, geography 0.25,
volume 0.20, identity 0.15, documents 0.10), each returned with its own level and reason. A floor
derived from the worst factor stops a prohibited or high-risk signal from being averaged away, so
prohibited MCCs/countries always surface as `prohibited`.

Underwriting consumes the latest risk assessment plus verification state: prohibited risk →
`declined`; missing business/owner/bank verification or high risk → `manual_review`; otherwise
`approved` with processing limits, a pricing tier, and reason codes. Every decision is persisted and
emits the matching webhook event.

## Webhooks

Endpoints must be HTTPS. The signing secret is returned **once** at registration and never listed
again. Deliveries are signed `X-Webhook-Signature: v1=<hmac-sha256(secret, timestamp + body)>` with
`X-Webhook-Timestamp`, retried with backoff, and recorded per attempt
(`GET /v1/webhooks/{id}/deliveries`).

## Testing

```bash
npm run lint
npm run typecheck
npm test                                      # unit tests
DATABASE_URL=postgresql://onboarding:onboarding@localhost:5432/onboarding_test?schema=public \
  npm run test:e2e                            # e2e against a real database
npm run build
```

The e2e suites boot the real Nest app with the same global pipes/guards as `main.ts` and cover the
onboarding flow, authentication/authorization/tenant isolation, and webhook signing and retries.
Point them at `onboarding_test` (migrated with `prisma migrate deploy`) — they write real rows.

## Scope and limitations

Sandbox-only by design: no production KYB/KYC, registry, bureau, biometric, or banking integrations;
risk scoring is rules-based rather than ML; documents are stored on the local filesystem; webhook
retries run in-process rather than on a durable queue; no frontend or embedded SDK.
