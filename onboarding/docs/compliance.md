# Compliance and data protection

## Regional rule sets

Requirements are data, not branching code: `src/modules/compliance/regional-rules.ts`
holds per-country rules (US, GB, CA, AU, EU member states, and a conservative fallback)
covering required documents, identifier labels, beneficial-ownership threshold, default
currency and locale, applicable regulations, screening lists and data residency. The
merchant's country and entity type therefore determine its onboarding steps, and
`GET /v1/compliance/requirements` exposes the same rules so forms stay in step with the
backend.

Each merchant stores a compliance profile: PCI level, GDPR applicability, regional
regulations, screening lists, data residency and ownership threshold.

## KYB / KYC / AML

- **KYB** — registry, credit-bureau or business-database checks with matched and
  mismatched fields recorded per attempt.
- **KYC** — per beneficial owner, by document upload, biometric or database check, and
  only with explicit `consent: true`.
- **Beneficial ownership** — companies must disclose owners above the country's threshold
  (25% in most jurisdictions); combined ownership above 100% is rejected. Sole traders are
  exempt.
- **Sanctions screening** — screened against the lists configured for the region; hits
  fail verification, raise the risk score and route to manual review.
- **Bank validation** — instant checks or micro-deposits with confirmation.

Every attempt is retained with provider, request metadata, response metadata, outcome and
failure reason: the audit trail a regulator asks for.

## PCI DSS

No cardholder data is collected or stored by this service, which keeps it out of CDE
scope. Each merchant's PCI validation level is derived from annualised card volume using
the standard Level 1 (>$6M), 2 (>$1M) and 3 (>20k e-commerce) thresholds and exposed on
the merchant's compliance profile. Transport is HTTPS only; secrets live in Secret
Manager.

## GDPR and data protection

- **Lawful basis and consent** — identity verification will not run without explicit
  consent, recorded on the attempt.
- **Data minimisation** — intake asks for the minimum; national identifiers are accepted
  only as the last four digits, tax identifiers are stored masked with a last-four, and
  full bank account numbers are AES-256-GCM tokenised with only the last four in plain
  columns. Raw identifiers are used transiently for a provider call and never persisted.
- **Purpose limitation** — audit logs record masked identifiers, actor, action, resource
  and request id, never sensitive values, and API responses never return secrets or full
  account numbers.
- **Access control** — every read and write is scoped to the owning partner, and
  session tokens are scoped to a single merchant.
- **Data residency** — the residency requirement per country is exposed on the compliance
  profile; deploy regional instances (regional Cloud SQL and Cloud Storage) where
  in-region processing is required.
- **Retention and erasure** — records are keyed by partner and merchant so subject-access
  and erasure requests can be satisfied per merchant; keep verification evidence for the
  statutory AML retention period (typically five years) before deleting.

## Audit logging

Append-only audit entries for every state change — creation, information submission,
verification, risk assessment, underwriting decision, status change, key issuance and
revocation — with actor, actor type, resource, changes, IP address and request id.
Exportable via `GET /v1/analytics/audit-logs`.

## Security controls

- API-key secrets stored as SHA-256 hashes, shown once, revocable, with last-used
  tracking.
- Short-lived merchant-scoped JWTs for browser flows.
- Scope- and role-based authorisation; `viewer` credentials cannot mutate.
- Idempotency keys on mutating requests.
- HMAC-SHA256 signed webhooks with timestamps, to be verified in constant time.
- Rate limiting, security headers (Helmet), strict payload validation that strips unknown
  fields, and uniform errors that never leak internals.
