# API reference

Base URL: `https://<host>/v1`. The authoritative, always-current schema is the generated
OpenAPI document at `GET /docs/openapi.json` (Swagger UI at `GET /docs`); this page is the
narrative version.

## Authentication

| Credential | Header | Use |
| --- | --- | --- |
| Partner API key | `X-Api-Key: <secret>` or `Authorization: Api-Key <secret>` | server-to-server |
| Onboarding session token | `Authorization: Bearer <jwt>` | embedded UI / white-label browser flows, scoped to one merchant |
| Bootstrap admin key | `X-Api-Key: <ADMIN_API_KEY>` | provisioning partners and keys only |

Secrets are stored as SHA-256 hashes; a key secret is shown once at creation. Session
tokens are short-lived (`JWT_TTL_SECONDS`), carry a `merchant_reference`, and are rejected
on any other merchant.

### Scopes and roles

Scopes: `merchants:read`, `merchants:write`, `verification:write`, `risk:read`,
`risk:write`, `underwriting:read`, `underwriting:write`, `webhooks:read`,
`webhooks:write`, `analytics:read`, `partners:admin`.

Roles: `admin`, `operator`, `viewer`. A `viewer` credential is rejected on any unsafe
method even if its scopes would otherwise allow it.

## Conventions

- **Idempotency** — send `Idempotency-Key` on POST/PATCH. The first response is stored and
  replayed for repeats of the same key, so retries never double-create.
- **Request ids** — every response has `X-Request-Id`; supply your own to correlate logs.
- **Errors** — uniform envelope, never framework-shaped:

```json
{
  "error": {
    "type": "validation_error",
    "code": "invalid_request_parameter",
    "message": "mcc must be a 4 digit merchant category code",
    "param": "mcc",
    "request_id": "req_8f2b..."
  }
}
```

  `type` is one of `validation_error`, `authentication_error`, `authorization_error`,
  `not_found_error`, `conflict_error`, `rate_limit_error`, `api_error`.

## Merchants

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| POST | `/merchants` | `merchants:write` | Create an application. Returns `merchant_id`, an onboarding token and `required_steps`. |
| GET | `/merchants` | `merchants:read` | List with `status`, `country`, `limit`, `cursor`. |
| GET | `/merchants/{id}` | `merchants:read` | Full profile, onboarding state, compliance profile. |
| PATCH | `/merchants/{id}` | `merchants:write` | Update contact, MCC, volume, products, address, locale. Repricing inputs recompute the PCI level. |
| GET | `/merchants/{id}/status` | `merchants:read` | Steps, `outstanding_actions`, verification history, latest decision, `estimated_completion`. |
| POST | `/merchants/{id}/business-verification` | `merchants:write` | Submit KYB details: `legal_name`, `tax_id`, `registration_number`, `incorporation_date`, and the registered address as `business_address` (not `address`, which on `POST /merchants` is the operating address). |
| POST/GET | `/merchants/{id}/owners` | `merchants:write` / `read` | Beneficial owners; combined ownership above 100% is rejected. |
| POST/GET | `/merchants/{id}/bank-accounts` | `merchants:write` / `read` | Settlement accounts; only the last four digits are ever returned. |
| POST/GET | `/merchants/{id}/documents` | `merchants:write` / `read` | Base64 uploads with type, filename, content type, optional expiry. |
| GET | `/documents/expiring` | `merchants:read` | Documents expiring within `days` (compliance monitoring). |
| POST | `/merchants/{id}/onboarding-token` | `merchants:write` | Mint a merchant-scoped session token for a browser. |
| POST | `/merchants/{id}/suspend` | `merchants:write` | Suspend with a reason. |
| POST | `/merchants/{id}/activate` | `merchants:write` | Activate an approved merchant. |

Intake asks only for entity type, country, contact, business name, MCC and projected
volume; everything else is collected progressively based on the merchant's country and
entity type.

## Verification

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| POST | `/verify/business` | `verification:write` | KYB against registry / credit bureau / business database, plus sanctions screening. |
| POST | `/verify/identity` | `verification:write` | KYC per owner: `document_upload`, `biometric` or `database_check`. Requires `consent: true`. |
| POST | `/verify/bank-account` | `verification:write` | `instant` or `micro_deposits`. |
| POST | `/verify/bank-account/confirm` | `verification:write` | Confirm micro-deposit amounts. Wrong amounts record a failed attempt rather than erroring. |
| GET | `/verify/merchants/{id}` | `merchants:read` | Attempt history: type, subject, status, provider, timestamps, failure reason. |

Every attempt is persisted with provider, request metadata, response metadata and failure
reason, advances the relevant onboarding step, and emits a webhook. Deposit amounts are
never echoed back to the caller.

## Risk

| Method | Path | Scope |
| --- | --- | --- |
| POST | `/risk/assess` | `risk:write` |
| POST | `/risk/reassess` | `risk:write` |
| GET | `/risk/merchants/{id}` | `risk:read` |

Scores are explainable: each response lists weighted factors (business category,
geography, projected volume, business tenure, verification completeness, sanctions
screening, storefront presence) with a human-readable `detail`, plus `risk_level`
(`low`, `medium`, `high`, `prohibited`) and recommendations.

## Underwriting

| Method | Path | Scope |
| --- | --- | --- |
| POST | `/underwriting/submit` | `underwriting:write` |
| GET | `/merchants/{id}/underwriting-status` | `underwriting:read` |
| POST | `/merchants/{id}/underwriting-decision` | `underwriting:write` |

Submission requires complete onboarding unless `allow_incomplete` is set (sandbox and
pilots). Low/medium risk with clean verifications auto-approves with processing limits and
a pricing tier; high risk or outstanding blockers route to `manual_review`; prohibited
categories decline. Manual decisions take a `decision`, `reason` and `reviewer`.

## Webhooks

| Method | Path | Scope |
| --- | --- | --- |
| POST/GET | `/webhooks` | `webhooks:write` / `webhooks:read` |
| PATCH/DELETE | `/webhooks/{id}` | `webhooks:write` |
| GET | `/webhooks/{id}/deliveries` | `webhooks:read` |
| POST | `/webhooks/deliveries/{deliveryId}/retry` | `webhooks:write` |

Events: `merchant.created`, `merchant.updated`, `merchant.verification_completed`,
`merchant.verification_failed`, `merchant.risk_flagged`,
`merchant.underwriting_approved`, `merchant.underwriting_declined`,
`merchant.underwriting_manual_review`, `merchant.activated`, `merchant.suspended`,
`bank_account.verified`, `bank_account.verification_failed`, `document.expiring`.

Signature header, HMAC-SHA256 of `"{timestamp}.{raw_body}"` with the endpoint secret:

```
x-onboarding-signature: t=1700000000,v1=6f1a...
```

Verify before trusting a payload, and compare digests in constant time:

```ts
const [t, v1] = header.split(',').map((part) => part.split('=')[1]);
const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(v1)) &&
  Math.abs(Date.now() / 1000 - Number(t)) < 300;
```

Failed deliveries retry with exponential backoff up to `WEBHOOK_MAX_ATTEMPTS`; every
attempt is recorded with response status and body excerpt.

## Compliance

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/compliance/requirements?country=DE&business_type=company` | Drives smart forms: required steps, documents, field labels, ownership threshold, currency, locale, regulations. |
| GET | `/compliance/countries/{country}` | Full regional rule set for a country. |

## Analytics

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/analytics/onboarding?period_days=30` | Funnel: step completion, approval, activation and abandonment rates, median hours to activation. |
| GET | `/analytics/risk?period_days=30` | Risk mix, average score, decision split, automated share, pricing tiers. |
| GET | `/analytics/audit-logs?merchant_id=&limit=` | Audit trail export. |

## Partners (platform operators)

`POST /partners`, `GET /partners`, `POST /partners/{id}/api-keys`,
`GET /partners/{id}/api-keys`, `DELETE /partners/api-keys/{prefix}` — all require
`partners:admin`. Key metadata is listable; secrets are not.

## Health

`GET /healthz` (liveness) and `GET /readyz` (readiness, includes the database) are
unversioned and unauthenticated.
