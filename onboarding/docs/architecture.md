# Architecture

## Shape

A single stateless NestJS service over PostgreSQL, organised by domain:

```
src/
  common/        auth (API keys, session JWTs, scopes), audit, idempotency,
                 request context, error envelope, Prisma, crypto helpers
  modules/
    merchants/     intake, progressive onboarding state, owners, bank accounts, documents
    verification/  KYB / KYC / bank checks behind provider interfaces
    risk/          explainable, weighted risk scoring
    underwriting/  automated decisioning, limits, pricing, manual override
    compliance/    per-country rule sets and smart-form requirements
    webhooks/      registration, signing, delivery, retries, replay
    partners/      tenant and API-key provisioning
    analytics/     funnel, risk mix, audit export
```

Cross-cutting behaviour is global rather than per-controller: an auth guard, an
idempotency interceptor, an exception filter that produces one error envelope, a
request-id middleware, URI versioning and a validation pipe that strips unknown fields.

### Key decisions

- **Progressive onboarding as state, not screens.** Requirements are computed from country
  plus entity type into an onboarding state machine; each verification advances a step,
  and `outstanding_actions` tells any client what is left. Adding a country is a data
  change.
- **Providers behind interfaces.** `BusinessVerificationProvider`,
  `IdentityVerificationProvider` and `BankVerificationProvider` are injected by token, so
  vendors can be swapped per region and the bundled deterministic sandbox providers make
  every branch testable without network access.
- **Explainable risk.** Weighted factors with human-readable detail, so an underwriter and
  a regulator can both see why a score happened. Underwriting consumes the same engine.
- **Tenancy as an invariant.** Every query is scoped to the partner; session tokens are
  additionally pinned to one merchant. Cross-tenant reads 404 rather than 403 so
  existence does not leak.
- **Sensitive values never at rest in the clear.** Key secrets hashed; bank account
  numbers tokenised (AES-256-GCM) with only last four in plain columns; national and tax
  identifiers masked.

## Data model

`Partner` → `ApiKey`, `Merchant`; `Merchant` → `Owner`, `BankAccount`, `Document`,
`VerificationAttempt`, `RiskAssessment`, `UnderwritingDecision`, `OnboardingToken`,
`AuditLog`; `Webhook` → `WebhookDelivery`; plus `IdempotencyKey`. Onboarding state,
compliance profile, processing limits and provider payloads are JSON columns so the
schema does not churn per country or vendor.

## GCP deployment

| Concern | Service |
| --- | --- |
| API | Cloud Run (stateless, scale to zero) or GKE where sidecars are needed |
| Database | Cloud SQL for PostgreSQL 16, private IP, automated backups, PITR |
| Cache / rate limiting | Memorystore (Redis) |
| Async delivery | Pub/Sub for webhook fan-out and retry scheduling |
| Documents | Cloud Storage with CMEK, uniform bucket-level access |
| Secrets | Secret Manager (`DATABASE_URL`, `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, provider keys) |
| CI/CD | Cloud Build → Artifact Registry → Cloud Run with migrations as a pre-deploy job |
| Observability | Cloud Logging / Monitoring / Trace, alerting on error rate, p95 latency, delivery failures and manual-review backlog |

Notes:

- Run `prisma migrate deploy` as a separate step before the new revision receives
  traffic; the service itself never migrates on boot.
- `/healthz` is the liveness probe and `/readyz` (which touches the database) the
  readiness probe.
- For data residency, deploy one regional stack per jurisdiction — regional Cloud Run,
  Cloud SQL and buckets — and route by merchant country.
- The container is defined by `Dockerfile`; `docker-compose.yml` is for local PostgreSQL
  and a local run of the service.
