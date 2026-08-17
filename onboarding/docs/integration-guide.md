# Integration guide

Four integration patterns share one API and one data model, so a merchant onboarded
through an embedded widget is indistinguishable downstream from one onboarded over REST.

## 1. Direct REST API

Server-to-server with a partner API key. You own the UI.

1. `POST /v1/merchants` with entity type, country, contact, business name, MCC and
   projected volume. Send `Idempotency-Key`. Keep `required_steps` from the response.
2. `POST /v1/merchants/{id}/business-verification` — KYB details; the registered address
   goes in `business_address`, distinct from the operating `address` on the merchant.
3. `POST /v1/merchants/{id}/owners` — beneficial owners (companies only; the threshold per
   country comes from `/v1/compliance/requirements`).
4. `POST /v1/merchants/{id}/bank-accounts` — settlement account.
5. `POST /v1/merchants/{id}/documents` — whatever `required_documents` lists.
6. `POST /v1/verify/business`, `/v1/verify/identity`, `/v1/verify/bank-account`.
7. `POST /v1/underwriting/submit`, then `POST /v1/merchants/{id}/activate` on approval.

Poll `GET /v1/merchants/{id}/status` only when you cannot receive webhooks; the status
response also lists `outstanding_actions` so you can render exactly what is missing.

## 2. Embedded onboarding UI

Keep the partner API key on your server; give the browser a scoped token.

1. Server: `POST /v1/merchants` (or `POST /v1/merchants/{id}/onboarding-token` later) and
   return only `onboarding_token` to the browser.
2. Browser: call `/v1/merchants/{id}/...` with `Authorization: Bearer <token>`. The token
   is limited to `merchants:read`, `merchants:write` and `verification:write` on that one
   merchant and expires within the hour; any other merchant returns 403.
3. Server: subscribe to `merchant.underwriting_*` webhooks and drive activation.

Never ship a partner API key to a browser; anything a browser needs is reachable with a
session token.

## 3. White-label onboarding

Same flow as embedded, plus presentation and localisation:

- Set `branding` (logo, primary colour, domain, support email) on the partner so hosted
  screens render as your brand.
- Use `GET /v1/compliance/requirements?country=..&business_type=..` to build region-aware
  forms: field labels (`registration_number_label`, `national_id_label`,
  `bank_identifier_label`), required documents, ownership threshold, currency, locale.
- Pass `locale` on the merchant to drive copy and formatting.

## 4. Marketplace / platform onboarding

High-volume sub-merchant onboarding, typically micro-merchants:

- One partner per platform; every merchant is isolated to that partner. Cross-partner
  reads return 404, so nothing leaks between platforms.
- Onboard progressively: create merchants with the minimum, let sellers finish later with
  session tokens, and rely on `required_steps` to know who is blocked.
- Sole traders skip beneficial ownership entirely, which is usually most of a marketplace.
- Automate the tail: subscribe to `merchant.underwriting_manual_review` and only touch the
  cases the engine could not decide.
- Send `Idempotency-Key` on every create so bulk imports are safely retryable.

## Webhooks

Register one endpoint per environment, subscribe to the events you handle, verify the
`x-onboarding-signature` HMAC (see the [API reference](api-reference.md#webhooks)), then
respond `2xx` quickly and process asynchronously. Failed deliveries retry with
exponential backoff; inspect `GET /v1/webhooks/{id}/deliveries` and replay with
`POST /v1/webhooks/deliveries/{deliveryId}/retry`.

Treat webhooks as at-least-once: deduplicate on the event id (`evt_...`).

## Testing

The bundled sandbox providers are deterministic, so you can drive every branch —
registry miss, sanctions hit, identity failure, closed bank account, micro-deposit
pending, prohibited category — from the input alone. See the trigger table in the
[README](../README.md#sandbox-triggers).

## Going live

- Swap `VERIFICATION_PROVIDER_MODE` to a real provider implementation of
  `BusinessVerificationProvider`, `IdentityVerificationProvider` and
  `BankVerificationProvider` (one seam per check, so vendors can differ per region).
- Issue `livemode` keys, scoped narrowly: most integrations need neither
  `partners:admin` nor `analytics:read`.
- Store the webhook secret in your secret manager and rotate with `PATCH /v1/webhooks/{id}`.
- Alert on `merchant.underwriting_manual_review` volume and on delivery failures.
