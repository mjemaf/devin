# API reference

Base URL: `http://localhost:3000/v1`. All bodies are JSON. Swagger/OpenAPI is served at `/docs`.

## Authentication

| Mechanism | Header | Use |
| --- | --- | --- |
| Partner API key | `Authorization: Bearer sk_...` or `X-Api-Key: sk_...` | Server-to-server, all endpoints |
| Onboarding token | `Authorization: Bearer <jwt>` | Embedded/white-label clients; scoped to one merchant |

Roles expand to scopes:

| Role | Scopes |
| --- | --- |
| `admin` | all |
| `operator` | `merchants:read`, `merchants:write`, `verification:write`, `risk:read`, `risk:write`, `underwriting:write` |
| `viewer` | `merchants:read`, `risk:read` |

Optional headers: `Idempotency-Key` (POST/PATCH/PUT), `X-Request-Id` (echoed back as
`error.request_id`). Rate limiting is per API key, `RATE_LIMIT_PER_MINUTE` requests per minute.

## Errors

```json
{
  "error": {
    "type": "validation_error",
    "code": "invalid_request_parameter",
    "message": "mcc must be a 4-digit merchant category code",
    "param": "mcc",
    "request_id": "req_..."
  }
}
```

| `type` | Status |
| --- | --- |
| `validation_error` | 400 |
| `authentication_error` | 401 |
| `authorization_error` | 403 |
| `not_found_error` | 404 |
| `conflict_error` | 409 |
| `rate_limit_error` | 429 |
| `api_error` | 500 |

## Endpoints

| Method | Path | Scope |
| --- | --- | --- |
| `GET` | `/health` | public |
| `POST` | `/merchants` | `merchants:write` |
| `GET` | `/merchants` | `merchants:read` |
| `GET` | `/merchants/{merchant_id}` | `merchants:read` |
| `PATCH` | `/merchants/{merchant_id}` | `merchants:write` |
| `GET` | `/merchants/{merchant_id}/status` | `merchants:read` |
| `POST` | `/merchants/{merchant_id}/business-verification` | `merchants:write` |
| `POST` | `/merchants/{merchant_id}/owners` | `merchants:write` |
| `GET` | `/merchants/{merchant_id}/owners` | `merchants:read` |
| `POST` | `/merchants/{merchant_id}/bank-accounts` | `merchants:write` |
| `GET` | `/merchants/{merchant_id}/bank-accounts` | `merchants:read` |
| `POST` | `/merchants/{merchant_id}/bank-accounts/{bank_account_id}/confirm-micro-deposits` | `merchants:write` |
| `POST` | `/merchants/{merchant_id}/documents` | `merchants:write` |
| `GET` | `/merchants/{merchant_id}/documents` | `merchants:read` |
| `POST` | `/merchants/{merchant_id}/suspend` | `merchants:write` |
| `POST` | `/merchants/{merchant_id}/activate` | `merchants:write` |
| `POST` | `/verify/business` | `verification:write` |
| `POST` | `/verify/identity` | `verification:write` |
| `POST` | `/verify/bank-account` | `verification:write` |
| `GET` | `/merchants/{merchant_id}/verification-attempts` | `merchants:read` |
| `POST` | `/risk/assess` | `risk:write` |
| `POST` | `/risk/reassess` | `risk:write` |
| `GET` | `/merchants/{merchant_id}/risk-assessments` | `risk:read` |
| `POST` | `/underwriting/submit` | `underwriting:write` |
| `GET` | `/merchants/{merchant_id}/underwriting-status` | `merchants:read` |
| `POST` | `/webhooks` | `webhooks:write` |
| `GET` | `/webhooks` | `webhooks:write` |
| `GET` | `/webhooks/{webhook_id}/deliveries` | `webhooks:write` |
| `DELETE` | `/webhooks/{webhook_id}` | `webhooks:write` |

Public identifiers are opaque and prefixed: `mer_`, `owner_`, `ba_`, `doc_`, `ver_`, `risk_`, `uw_`,
`wh_`, `evt_`, `par_`.

## Merchants

`POST /merchants` — progressive onboarding: only the fields below are needed to start.

```json
{
  "business_type": "llc",
  "business_name": "Blue Bottle Coffee LLC",
  "country": "US",
  "email": "owner@example.com",
  "phone": "+14155550123",
  "mcc": "5812",
  "estimated_monthly_volume": 25000,
  "website": "https://example.com",
  "products_sold": ["coffee"]
}
```

Response `201`:

```json
{
  "merchant_id": "mer_veal34zsqbchvdxu",
  "status": "pending",
  "onboarding_token": "eyJ...",
  "required_steps": ["business_verification", "bank_account_setup", "owner_verification", "underwriting"],
  "created_at": "2026-08-17T21:36:33.419Z"
}
```

`business_type` is one of `sole_proprietorship`, `partnership`, `llc`, `corporation`, `non_profit`,
`individual`. `GET /merchants` supports `status`, `limit`, `offset`.

`POST /merchants/{id}/business-verification` (`200`) submits KYB details — `legal_name`, `tax_id`,
`incorporation_date`, `incorporation_country`, `business_address`, optional `dba_name`,
`registration_number`, `incorporation_state`. `tax_id` is tokenized at rest; only `tax_id_last4` is
ever returned. Required document types and screenings follow the incorporation country's regional
profile (US, GB, DE, FR, CA, AU, SG, plus a global fallback).

`GET /merchants/{id}/status` returns `overall_status` and each onboarding step with
`required_actions` and `completed_at`.

## Owners, bank accounts, documents

`POST /merchants/{id}/owners` takes `{ "owners": [...] }`; each owner needs `first_name`,
`last_name`, `email`, `date_of_birth`, `address`, `ownership_percentage`, optional `phone`, `title`,
`is_control_person`, `tax_id_last4`.

`POST /merchants/{id}/bank-accounts` takes `account_number`, `routing_number`, `account_type`
(`checking`/`savings`), `currency`, `account_holder_name`, optional `verification_method`
(`instant` or `micro_deposits`) and `is_default`. The account number is tokenized;
`account_number_last4` is returned. Micro-deposits are confirmed with
`{ "amounts": [12, 34] }` (cents).

`POST /merchants/{id}/documents` takes `{ "documents": [{ "type", "file", "filename",
"content_type", "owner_id?" }] }` where `file` is base64. Contents are stored via the storage driver
and never echoed back.

## Verification

```http
POST /verify/business    { "merchant_id": "mer_...", "verification_sources": ["government_registry"], "priority": "standard" }
POST /verify/identity    { "merchant_id": "mer_...", "owner_id": "owner_...", "verification_method": "database_check", "consent": true }
POST /verify/bank-account{ "merchant_id": "mer_...", "bank_account_id": "ba_...", "verification_method": "instant" }
```

Each returns a `VerificationAttempt` (`id`, `verification_type`, `subject_id`, `status`, `provider`,
`result`, `error`, timestamps) with status `verified`, `failed`, or `pending` for manual review.
`consent` must be `true` for identity checks. `GET /merchants/{id}/verification-attempts` lists
history. Sandbox triggers are documented in the README.

## Risk

`POST /risk/assess` — `{ "merchant_id": "mer_...", "assessment_type": "onboarding", "factors": [...] }`
(`factors` filters the response; `assessment_type` is `onboarding`, `periodic`, or `triggered`).
`POST /risk/reassess` takes the same body and always recomputes.

```json
{
  "merchant_id": "mer_...",
  "id": "risk_z39hys5q609v2up9",
  "risk_score": 13,
  "risk_level": "low",
  "factors": {
    "industry_risk": { "level": "low", "score": 15, "reason": "MCC 5812 is a standard retail category" },
    "geographic_risk": { "level": "low", "score": 10, "reason": "US is a low-risk jurisdiction" }
  },
  "recommendations": ["standard_monitoring", "transaction_limits:5000"],
  "assessment_type": "onboarding",
  "assessed_at": "2026-08-17T21:36:33.669Z"
}
```

`risk_level` is `low` (0–29), `medium` (30–59), `high` (60–84), or `prohibited` (85+). High and
prohibited results emit `merchant.risk_flagged`.

## Underwriting

`POST /underwriting/submit` — `{ "merchant_id": "mer_...", "underwriting_type": "automated", "expedited": false }`.
A risk assessment is computed automatically if none exists.

```json
{
  "merchant_id": "mer_...",
  "id": "uw_8zlzlcb0zzlgg51g",
  "decision": "approved",
  "reason": "All verification checks passed",
  "reason_codes": ["automated_approval"],
  "processing_limits": { "currency": "USD", "daily_limit": 10000, "monthly_limit": 100000, "ticket_size_limit": 5000 },
  "pricing_tier": "standard",
  "underwriting_type": "automated",
  "reviewed_at": "2026-08-17T21:36:33.693Z",
  "expires_at": "2026-08-24T21:36:33.692Z"
}
```

`decision` is `approved`, `declined`, or `manual_review`; `processing_limits` and `pricing_tier` are
`null` unless approved. `GET /merchants/{id}/underwriting-status` returns the latest decision.

## Webhooks

`POST /webhooks` — `{ "url": "https://...", "events": ["merchant.created"], "secret": "whsec_..." }`.
HTTP URLs are rejected. The response includes `secret` **once**; later listings omit it.

Events: `merchant.created`, `merchant.updated`, `merchant.verification_completed`,
`merchant.verification_failed`, `merchant.risk_flagged`, `merchant.underwriting_approved`,
`merchant.underwriting_declined`, `merchant.underwriting_manual_review`, `merchant.activated`,
`merchant.suspended`, `bank_account.verified`, `document.uploaded`.

Delivery payload and headers:

```json
{ "id": "evt_...", "event_type": "merchant.created", "created_at": "2026-08-17T21:36:33.419Z", "data": { "...": "..." } }
```

```http
X-Webhook-Timestamp: 1787002593
X-Webhook-Signature: v1=<hex hmac-sha256(secret, "<timestamp>.<raw body>")>
```

Verify by recomputing the HMAC over `"<timestamp>.<raw body>"` and comparing in constant time.
Failed deliveries are retried with backoff; `GET /webhooks/{id}/deliveries` reports `attempts`,
`status`, `response_status`, and timestamps. `DELETE /webhooks/{id}` deactivates the endpoint and
stops delivery.
