import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  BASE,
  TestPartner,
  bankAccountPayload,
  businessDetailsPayload,
  createPartner,
  createTestApp,
  merchantPayload,
  ownerPayload,
} from './app.factory';

describe('Onboarding flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let partner: TestPartner;

  const auth = () => ({ Authorization: `Bearer ${partner.apiKey}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    partner = await createPartner(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createMerchant(overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(auth())
      .send(merchantPayload(overrides))
      .expect(201);
    return response.body.merchant_id as string;
  }

  it('boards a merchant from creation to automated approval', async () => {
    const created = await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(auth())
      .send(merchantPayload())
      .expect(201);

    expect(created.body).toMatchObject({ status: 'pending' });
    expect(created.body.merchant_id).toMatch(/^mer_/);
    expect(created.body.onboarding_token).toBeDefined();
    expect(created.body.required_steps).toEqual([
      'business_verification',
      'bank_account_setup',
      'owner_verification',
      'underwriting',
    ]);
    const merchantId = created.body.merchant_id as string;

    await request(app.getHttpServer())
      .post(`${BASE}/merchants/${merchantId}/business-verification`)
      .set(auth())
      .send(businessDetailsPayload())
      .expect(200);

    await request(app.getHttpServer())
      .post(`${BASE}/verify/business`)
      .set(auth())
      .send({ merchant_id: merchantId })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('verified'));

    const owners = await request(app.getHttpServer())
      .post(`${BASE}/merchants/${merchantId}/owners`)
      .set(auth())
      .send({ owners: [ownerPayload()] })
      .expect(201);
    const ownerId = owners.body.data[0].id as string;
    expect(owners.body.data[0].is_control_person).toBe(true);

    await request(app.getHttpServer())
      .post(`${BASE}/verify/identity`)
      .set(auth())
      .send({ merchant_id: merchantId, owner_id: ownerId, consent: true })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('verified'));

    const bank = await request(app.getHttpServer())
      .post(`${BASE}/merchants/${merchantId}/bank-accounts`)
      .set(auth())
      .send(bankAccountPayload())
      .expect(201);
    expect(bank.body.account_number_last4).toBe('6789');
    expect(bank.body).not.toHaveProperty('account_number');

    await request(app.getHttpServer())
      .post(`${BASE}/verify/bank-account`)
      .set(auth())
      .send({ merchant_id: merchantId, bank_account_id: bank.body.id })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('verified'));

    const risk = await request(app.getHttpServer())
      .post(`${BASE}/risk/assess`)
      .set(auth())
      .send({ merchant_id: merchantId })
      .expect(201);
    expect(risk.body.risk_level).toBe('low');
    expect(Object.keys(risk.body.factors)).toHaveLength(5);

    const underwriting = await request(app.getHttpServer())
      .post(`${BASE}/underwriting/submit`)
      .set(auth())
      .send({ merchant_id: merchantId })
      .expect(201);
    expect(underwriting.body).toMatchObject({ decision: 'approved', pricing_tier: 'standard' });
    expect(underwriting.body.processing_limits.currency).toBe('USD');

    const status = await request(app.getHttpServer())
      .get(`${BASE}/merchants/${merchantId}/status`)
      .set(auth())
      .expect(200);
    expect(status.body.overall_status).toBe('approved');
    expect(status.body.steps.every((step: { status: string }) => step.status === 'completed')).toBe(
      true,
    );
  });

  it('routes an unverified merchant to manual review', async () => {
    const merchantId = await createMerchant({ email: 'unverified@example.com' });
    const underwriting = await request(app.getHttpServer())
      .post(`${BASE}/underwriting/submit`)
      .set(auth())
      .send({ merchant_id: merchantId })
      .expect(201);

    expect(underwriting.body.decision).toBe('manual_review');
    expect(underwriting.body.reason_codes).toContain('business_not_verified');
    expect(underwriting.body.processing_limits).toBeNull();
  });

  it('declines merchants outside the risk appetite', async () => {
    const merchantId = await createMerchant({ mcc: '7995', email: 'casino@example.com' });
    const risk = await request(app.getHttpServer())
      .post(`${BASE}/risk/assess`)
      .set(auth())
      .send({ merchant_id: merchantId })
      .expect(201);
    expect(risk.body.risk_level).toBe('prohibited');

    const underwriting = await request(app.getHttpServer())
      .post(`${BASE}/underwriting/submit`)
      .set(auth())
      .send({ merchant_id: merchantId })
      .expect(201);
    expect(underwriting.body.decision).toBe('declined');

    const merchant = await request(app.getHttpServer())
      .get(`${BASE}/merchants/${merchantId}`)
      .set(auth())
      .expect(200);
    expect(merchant.body.status).toBe('declined');
  });

  it('surfaces provider failures as failed verification attempts', async () => {
    const merchantId = await createMerchant({ business_name: 'FAIL Corp' });
    await request(app.getHttpServer())
      .post(`${BASE}/merchants/${merchantId}/business-verification`)
      .set(auth())
      .send(businessDetailsPayload({ legal_name: 'FAIL Corp' }))
      .expect(200);

    const verification = await request(app.getHttpServer())
      .post(`${BASE}/verify/business`)
      .set(auth())
      .send({ merchant_id: merchantId })
      .expect(201);
    expect(verification.body.status).toBe('failed');
    expect(verification.body.error).toBeDefined();
  });

  it('verifies bank accounts through micro-deposits', async () => {
    const merchantId = await createMerchant({ email: 'micro@example.com' });
    const bank = await request(app.getHttpServer())
      .post(`${BASE}/merchants/${merchantId}/bank-accounts`)
      .set(auth())
      .send(bankAccountPayload({ verification_method: 'micro_deposits' }))
      .expect(201);

    const stored = await prisma.bankAccount.findFirstOrThrow({
      where: { publicId: bank.body.id },
    });
    const amounts = stored.microDepositAmounts;
    expect(amounts).toHaveLength(2);

    await request(app.getHttpServer())
      .post(`${BASE}/merchants/${merchantId}/bank-accounts/${bank.body.id}/confirm-micro-deposits`)
      .set(auth())
      .send({ amounts: [amounts[0], amounts[1] === 1 ? 2 : 1] })
      .expect(200)
      .expect(({ body }) => expect(body.verification_status).toBe('failed'));

    await request(app.getHttpServer())
      .post(`${BASE}/merchants/${merchantId}/bank-accounts/${bank.body.id}/confirm-micro-deposits`)
      .set(auth())
      .send({ amounts })
      .expect(200)
      .expect(({ body }) => expect(body.verification_status).toBe('verified'));
  });

  it('stores documents by reference without echoing contents', async () => {
    const merchantId = await createMerchant({ email: 'docs@example.com' });
    const response = await request(app.getHttpServer())
      .post(`${BASE}/merchants/${merchantId}/documents`)
      .set(auth())
      .send({
        documents: [
          {
            type: 'bank_statement',
            filename: 'statement.pdf',
            content_type: 'application/pdf',
            file: Buffer.from('sample statement').toString('base64'),
          },
        ],
      })
      .expect(201);

    expect(response.body.data[0].id).toMatch(/^doc_/);
    expect(JSON.stringify(response.body)).not.toContain('sample statement');
  });
});
