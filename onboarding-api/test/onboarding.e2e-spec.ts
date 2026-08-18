import request from 'supertest';
import { Harness, startHarness } from './harness';

const merchantPayload = {
  business_type: 'company',
  country: 'US',
  email: 'owner@acme.example.com',
  phone: '+14155550123',
  business_name: 'Acme Corp',
  website: 'https://acme.example.com',
  mcc: '5734',
  estimated_monthly_volume: 50_000,
  products_sold: ['software'],
};

const businessInformation = {
  legal_name: 'Acme Corporation',
  dba_name: 'Acme',
  tax_id: '12-3456789',
  registration_number: 'C1234567',
  incorporation_date: '2015-06-15',
  business_address: {
    line1: '123 Main St',
    city: 'San Francisco',
    state: 'CA',
    postal_code: '94105',
    country: 'US',
  },
};

const bankAccount = {
  account_number: '000123456789',
  routing_number: '021000021',
  account_type: 'checking',
  currency: 'USD',
  account_holder_name: 'Acme Corporation',
  verification_method: 'instant',
};

describe('merchant onboarding (e2e)', () => {
  let harness: Harness;
  let api: () => request.Agent;

  beforeAll(async () => {
    harness = await startHarness();
    api = () => request(harness.app.getHttpServer());
  });

  afterAll(async () => {
    await harness.close();
  });

  const write = (path: string) =>
    api().post(path).set('X-API-Key', harness.partner.operatorKey);

  it('takes a merchant from application to activation', async () => {
    const created = await write('/v1/merchants').send(merchantPayload).expect(201);
    const merchantId: string = created.body.id;

    expect(created.body).toMatchObject({ object: 'merchant', status: 'pending', country: 'US' });
    expect(created.body.compliance).toMatchObject({ pci_level: 'level_4', gdpr_compliant: false });
    expect(created.body.onboarding_steps.map((step: { name: string }) => step.name)).toEqual([
      'business_verification',
      'bank_account_setup',
      'owner_verification',
      'tax_id_verification',
    ]);

    // KYB
    const kyb = await write(`/v1/merchants/${merchantId}/business-verification`)
      .send(businessInformation)
      .expect(201);
    expect(kyb.body).toMatchObject({ verification_type: 'business', status: 'verified' });

    // The raw tax id is never echoed back.
    const afterKyb = await api()
      .get(`/v1/merchants/${merchantId}`)
      .set('X-API-Key', harness.partner.viewerKey)
      .expect(200);
    expect(afterKyb.body.business_profile.tax_id_last4).toBe('6789');
    expect(JSON.stringify(afterKyb.body)).not.toContain('123456789');

    // Beneficial owner + KYC
    const owner = await write(`/v1/merchants/${merchantId}/owners`)
      .send({
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@acme.example.com',
        date_of_birth: '1985-04-12',
        ownership_percentage: 100,
        title: 'CEO',
        tax_id: '123-45-6789',
        is_control_person: true,
        address: {
          line1: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          postal_code: '94105',
          country: 'US',
        },
      })
      .expect(201);
    expect(owner.body).toMatchObject({ verification_status: 'pending', tax_id_last4: '6789' });

    const kyc = await write('/v1/verify/identity')
      .send({
        merchant_id: merchantId,
        owner_id: owner.body.id,
        verification_method: 'database_check',
        consent: true,
      })
      .expect(201);
    expect(kyc.body).toMatchObject({ verification_type: 'identity', status: 'verified' });

    // Settlement account, verified instantly, stored tokenised
    const account = await write(`/v1/merchants/${merchantId}/bank-accounts`)
      .send(bankAccount)
      .expect(201);
    expect(account.body).toMatchObject({
      account_number_last4: '6789',
      is_default: true,
      verification: { status: 'verified' },
    });
    expect(JSON.stringify(account.body)).not.toContain('000123456789');

    const stored = await harness.prisma.bankAccount.findFirstOrThrow({ where: { merchantId } });
    expect(stored.accountNumberToken).toMatch(/^tok_/);

    // Every onboarding step is now complete
    const status = await api()
      .get(`/v1/merchants/${merchantId}/status`)
      .set('X-API-Key', harness.partner.viewerKey)
      .expect(200);
    expect(status.body.pending_steps).toEqual([]);
    expect(status.body.status).toBe('under_review');

    // Risk + underwriting
    const risk = await write('/v1/risk/assess').send({ merchant_id: merchantId }).expect(201);
    expect(risk.body.risk_level).toBe('low');
    expect(risk.body.factors).toMatchObject({ identity_risk: 'low', geographic_risk: 'low' });

    const underwriting = await write('/v1/underwriting/submit')
      .send({ merchant_id: merchantId })
      .expect(201);
    expect(underwriting.body).toMatchObject({
      decision: 'approved',
      reason_codes: ['automated_approval'],
      pricing_tier: 'preferred',
    });
    expect(underwriting.body.processing_limits).toMatchObject({ currency: 'USD' });

    const activated = await api()
      .post(`/v1/merchants/${merchantId}/activate`)
      .set('X-API-Key', harness.partner.adminKey)
      .expect(201);
    expect(activated.body.status).toBe('active');

    // The whole flow is auditable
    const audit = await api()
      .get(`/v1/merchants/${merchantId}/audit-logs`)
      .set('X-API-Key', harness.partner.adminKey)
      .expect(200);
    expect(audit.body.data.map((entry: { action: string }) => entry.action)).toEqual(
      expect.arrayContaining([
        'merchant.created',
        'merchant.business_information_submitted',
        'merchant.owner_added',
        'merchant.bank_account_added',
        'underwriting.decision',
        'merchant.activated',
      ]),
    );
    expect(JSON.stringify(audit.body)).not.toContain('123456789');
    // Audit entries are correlated to the request that produced them.
    expect(audit.body.data.every((entry: { request_id: string }) => /^req_/.test(entry.request_id))).toBe(
      true,
    );
  });

  it('declines a sanctioned business without waiting for onboarding to finish', async () => {
    const created = await write('/v1/merchants').send(merchantPayload).expect(201);
    const merchantId: string = created.body.id;

    const kyb = await write(`/v1/merchants/${merchantId}/business-verification`)
      .send({ ...businessInformation, legal_name: 'Sanctioned Holdings Ltd' })
      .expect(201);
    expect(kyb.body).toMatchObject({ status: 'failed', failure_reason: 'sanctions_screening_hit' });

    const risk = await write('/v1/risk/assess').send({ merchant_id: merchantId }).expect(201);
    expect(risk.body.risk_level).toBe('prohibited');
    expect(risk.body.recommendations).toEqual(['decline_application']);

    // A screening hit decides immediately, without waiting for the remaining steps.
    const underwriting = await write('/v1/underwriting/submit')
      .send({ merchant_id: merchantId })
      .expect(201);
    expect(underwriting.body).toMatchObject({
      decision: 'declined',
      reason_codes: ['sanctions_screening_hit'],
    });

    const merchant = await api()
      .get(`/v1/merchants/${merchantId}`)
      .set('X-API-Key', harness.partner.viewerKey)
      .expect(200);
    expect(merchant.body.status).toBe('declined');
  });

  it('supports micro-deposit bank verification', async () => {
    const created = await write('/v1/merchants').send(merchantPayload).expect(201);
    const merchantId: string = created.body.id;

    const account = await write(`/v1/merchants/${merchantId}/bank-accounts`)
      .send({ ...bankAccount, verification_method: 'micro_deposits' })
      .expect(201);
    expect(account.body.verification).toMatchObject({
      status: 'in_progress',
      next_action: 'confirm_micro_deposits',
    });

    const pending = await harness.prisma.bankAccount.findUniqueOrThrow({
      where: { id: account.body.id },
    });
    expect(pending.microDepositAmounts).toHaveLength(2);

    const wrong = await write('/v1/verify/bank-account/micro-deposits')
      .send({
        merchant_id: merchantId,
        bank_account_id: account.body.id,
        amounts: pending.microDepositAmounts.map((amount) => (amount % 99) + 1),
      })
      .expect(400);
    expect(wrong.body.error.code).toBe('micro_deposit_amounts_mismatch');

    // A failed confirmation keeps the pending deposits usable...
    const reVerify = await write('/v1/verify/bank-account')
      .send({
        merchant_id: merchantId,
        bank_account_id: account.body.id,
        verification_method: 'micro_deposits',
      })
      .expect(201);
    expect(reVerify.body.status).toBe('in_progress');

    // ...so the correct amounts still verify the account.
    const confirmed = await write('/v1/verify/bank-account/micro-deposits')
      .send({
        merchant_id: merchantId,
        bank_account_id: account.body.id,
        amounts: pending.microDepositAmounts,
      })
      .expect(201);
    expect(confirmed.body.verification_status).toBe('verified');
  });

  it('rejects an invalid bank account for the merchant country', async () => {
    const created = await write('/v1/merchants').send(merchantPayload).expect(201);

    const response = await write(`/v1/merchants/${created.body.id}/bank-accounts`)
      .send({ ...bankAccount, routing_number: '021000022' })
      .expect(400);
    expect(response.body.error).toMatchObject({
      type: 'validation_error',
      code: 'bank_account_invalid',
      param: 'account_number',
    });
  });

  it('applies country-specific onboarding steps and bank formats', async () => {
    const created = await write('/v1/merchants')
      .send({ ...merchantPayload, country: 'DE', phone: '+4915112345678' })
      .expect(201);

    expect(created.body.compliance).toMatchObject({ gdpr_compliant: true, data_residency: 'eu' });
    expect(created.body.onboarding_steps.map((step: { name: string }) => step.name)).toContain(
      'psd2_sca_attestation',
    );

    const iban = await write(`/v1/merchants/${created.body.id}/bank-accounts`)
      .send({
        ...bankAccount,
        account_number: 'DE89370400440532013000',
        routing_number: '',
        currency: 'EUR',
      })
      .expect(201);
    expect(iban.body.verification.status).toBe('verified');
  });

  it('refuses to board a merchant in a prohibited country', async () => {
    const prohibited = await write('/v1/merchants')
      .send({ ...merchantPayload, country: 'IR' })
      .expect(400);
    expect(prohibited.body.error.code).toBe('country_prohibited');
  });

  it('routes a country without a region profile to manual compliance review', async () => {
    const created = await write('/v1/merchants')
      .send({ ...merchantPayload, country: 'BR', phone: '+5511987654321' })
      .expect(201);

    expect(created.body.onboarding_steps.map((step: { name: string }) => step.name)).toContain(
      'manual_compliance_review',
    );
  });

  it('caps total beneficial ownership at 100%', async () => {
    const created = await write('/v1/merchants').send(merchantPayload).expect(201);
    const owner = {
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@acme.example.com',
      date_of_birth: '1985-04-12',
      ownership_percentage: 60,
      address: {
        line1: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105',
        country: 'US',
      },
    };

    await write(`/v1/merchants/${created.body.id}/owners`).send(owner).expect(201);
    const second = await write(`/v1/merchants/${created.body.id}/owners`).send(owner).expect(400);
    expect(second.body.error.code).toBe('ownership_percentage_exceeded');
  });
});
