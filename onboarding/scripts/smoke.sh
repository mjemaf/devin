#!/usr/bin/env bash
# Walks the full happy-path onboarding flow against a running server.
# Usage: BASE=http://localhost:3000/v1 KEY=sk_sandbox_devin_local ./scripts/smoke.sh
set -euo pipefail

BASE=${BASE:-http://localhost:3000/v1}
KEY=${KEY:-sk_sandbox_devin_local}
AUTH=(-H "Authorization: Bearer ${KEY}" -H 'Content-Type: application/json')

json() { python3 -c "import json,sys;print(json.load(sys.stdin)$1)"; }

step() { printf '\n=== %s ===\n' "$1"; }

step 'create merchant'
MERCHANT=$(curl -sS "${AUTH[@]}" -H "Idempotency-Key: smoke-$(date +%s)" -d '{
  "business_type": "company",
  "country": "US",
  "email": "owner@smoke-example.com",
  "phone": "+14155550123",
  "business_name": "Smoke Test Coffee LLC",
  "website": "https://smoke-example.com",
  "mcc": "5812",
  "estimated_monthly_volume": 50000,
  "products_sold": ["coffee"]
}' "${BASE}/merchants")
echo "${MERCHANT}"
MID=$(echo "${MERCHANT}" | json "['merchant_id']")

step 'business details'
curl -sS "${AUTH[@]}" -d '{
  "legal_name": "Smoke Test Coffee LLC",
  "tax_id": "12-3456789",
  "registration_number": "SOS-99887766",
  "incorporation_date": "2019-04-01",
  "incorporation_country": "US",
  "incorporation_state": "CA",
  "business_address": {"line1": "1 Market St", "city": "San Francisco", "state": "CA", "postal_code": "94105", "country": "US"}
}' "${BASE}/merchants/${MID}/business-verification" > /dev/null
curl -sS "${AUTH[@]}" -d "{\"merchant_id\": \"${MID}\"}" "${BASE}/verify/business"

step 'owner + identity'
OWNER=$(curl -sS "${AUTH[@]}" -d '{"owners": [{
  "first_name": "Ada", "last_name": "Lovelace", "email": "ada@smoke-example.com",
  "phone": "+14155550124", "date_of_birth": "1985-12-10", "ownership_percentage": 100,
  "title": "CEO", "tax_id_last4": "6789",
  "address": {"line1": "1 Market St", "city": "San Francisco", "state": "CA", "postal_code": "94105", "country": "US"}
}]}' "${BASE}/merchants/${MID}/owners")
echo "${OWNER}"
OID=$(echo "${OWNER}" | json "['data'][0]['id']")
curl -sS "${AUTH[@]}" -d "{\"merchant_id\": \"${MID}\", \"owner_id\": \"${OID}\", \"consent\": true}" "${BASE}/verify/identity"

step 'bank account'
BANK=$(curl -sS "${AUTH[@]}" -d '{
  "account_number": "000123456789", "routing_number": "121000358",
  "account_type": "checking", "currency": "USD",
  "account_holder_name": "Smoke Test Coffee LLC", "verification_method": "instant"
}' "${BASE}/merchants/${MID}/bank-accounts")
echo "${BANK}"
BAID=$(echo "${BANK}" | json "['id']")
curl -sS "${AUTH[@]}" -d "{\"merchant_id\": \"${MID}\", \"bank_account_id\": \"${BAID}\", \"verification_method\": \"instant\"}" "${BASE}/verify/bank-account"

step 'documents'
curl -sS "${AUTH[@]}" -d "{\"documents\": [{\"type\": \"bank_statement\", \"content_type\": \"application/pdf\", \"filename\": \"statement.pdf\", \"file\": \"$(printf 'sample statement' | base64)\"}]}" "${BASE}/merchants/${MID}/documents"

step 'risk'
curl -sS "${AUTH[@]}" -d "{\"merchant_id\": \"${MID}\"}" "${BASE}/risk/assess"

step 'underwriting'
curl -sS "${AUTH[@]}" -d "{\"merchant_id\": \"${MID}\"}" "${BASE}/underwriting/submit"

step 'status'
curl -sS "${AUTH[@]}" "${BASE}/merchants/${MID}/status"
printf '\n'
