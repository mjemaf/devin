import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiException } from '../src/common/errors/api.exception';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { setupSwagger } from '../src/swagger';

const ADMIN_KEY = process.env.ADMIN_API_KEY ?? 'admin_local_dev_key';
const FULL_SCOPES = [
  'merchants:read',
  'merchants:write',
  'verification:write',
  'risk:read',
  'risk:write',
  'underwriting:read',
  'underwriting:write',
  'webhooks:read',
  'webhooks:write',
  'analytics:read',
];

const ADDRESS = {
  line1: '1 Market St',
  city: 'San Francisco',
  state: 'CA',
  postal_code: '94105',
  country: 'US',
};

/**
 * Exercises the documented onboarding journey end to end against a real database:
 * intake, progressive collection, KYB/KYC, bank validation, risk, underwriting and
 * activation, plus the auth, isolation and idempotency guarantees around them.
 */
describe('Onboarding API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let partnerId: string;
  let apiKey: string;

  const api = () => request(app.getHttpServer());
  const asPartner = (req: request.Test) => req.set('X-Api-Key', apiKey);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) =>
          ApiException.validation(
            'invalid_request_parameter',
            errors
              .map((error) => Object.values(error.constraints ?? {}).join(', '))
              .join('; ') || 'The request payload is invalid.',
            errors[0]?.property,
          ),
      }),
    );
    setupSwagger(app);
    await app.init();
    prisma = app.get(PrismaService);

    const partner = await api()
      .post('/v1/partners')
      .set('X-Api-Key', ADMIN_KEY)
      .send({ name: `E2E Platform ${Date.now()}`, integration_mode: 'direct_api' })
      .expect(201);
    partnerId = partner.body.id;

    const key = await api()
      .post(`/v1/partners/${partnerId}/api-keys`)
      .set('X-Api-Key', ADMIN_KEY)
      .send({ scopes: FULL_SCOPES, role: 'admin' })
      .expect(201);
    apiKey = key.body.secret;
  });

  afterAll(async () => {
    await prisma.partner.deleteMany({ where: { id: partnerId } });
    await app.close();
  });

  const createMerchant = (overrides: Record<string, unknown> = {}) =>
    asPartner(api().post('/v1/merchants')).send({
      business_type: 'company',
      country: 'US',
      email: 'owner@e2e.test',
      phone: '+14155550123',
      business_name: 'E2E Coffee LLC',
      mcc: '5812',
      estimated_monthly_volume: 45_000,
      ...overrides,
    });

  describe('authentication and authorisation', () => {
    it('rejects unauthenticated requests with the documented envelope', async () => {
      const response = await api().get('/v1/merchants').expect(401);
      expect(response.body.error).toMatchObject({ type: 'authentication_error' });
      expect(response.body.error.request_id).toMatch(/^req_/);
    });

    it('rejects an unknown API key', async () => {
      await api().get('/v1/merchants').set('X-Api-Key', 'sk_test_not_a_real_key').expect(401);
    });

    it('enforces scopes', async () => {
      const readOnly = await api()
        .post(`/v1/partners/${partnerId}/api-keys`)
        .set('X-Api-Key', ADMIN_KEY)
        .send({ scopes: ['merchants:read'], role: 'viewer' })
        .expect(201);

      const response = await api()
        .post('/v1/merchants')
        .set('X-Api-Key', readOnly.body.secret)
        .send({
          business_type: 'company',
          country: 'US',
          email: 'owner@e2e.test',
          phone: '+14155550123',
          business_name: 'Scope Test LLC',
          mcc: '5812',
          estimated_monthly_volume: 1000,
        })
        .expect(403);
      expect(response.body.error.type).toBe('authorization_error');
    });

    it('keeps merchants of other partners invisible', async () => {
      const mine = await createMerchant().expect(201);
      const other = await api()
        .post('/v1/partners')
        .set('X-Api-Key', ADMIN_KEY)
        .send({ name: `Other Platform ${Date.now()}`, integration_mode: 'direct_api' })
        .expect(201);
      const otherKey = await api()
        .post(`/v1/partners/${other.body.id}/api-keys`)
        .set('X-Api-Key', ADMIN_KEY)
        .send({ scopes: FULL_SCOPES, role: 'admin' })
        .expect(201);

      await api()
        .get(`/v1/merchants/${mine.body.merchant_id}`)
        .set('X-Api-Key', otherKey.body.secret)
        .expect(404);

      await prisma.partner.deleteMany({ where: { id: other.body.id } });
    });

    it('scopes onboarding session tokens to a single merchant', async () => {
      const first = await createMerchant().expect(201);
      const second = await createMerchant({ email: 'second@e2e.test' }).expect(201);

      const token = first.body.onboarding_token;
      await api()
        .get(`/v1/merchants/${first.body.merchant_id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await api()
        .get(`/v1/merchants/${second.body.merchant_id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });

  describe('validation and idempotency', () => {
    it('reports invalid payloads as validation errors', async () => {
      const response = await createMerchant({ country: 'ZZZ', mcc: 'abcd' }).expect(400);
      expect(response.body.error.type).toBe('validation_error');
      expect(response.body.error.message).toBeTruthy();
    });

    it('replays the original response for a repeated idempotency key', async () => {
      const key = `e2e-${Date.now()}`;
      const first = await asPartner(api().post('/v1/merchants'))
        .set('Idempotency-Key', key)
        .send({
          business_type: 'company',
          country: 'US',
          email: 'idem@e2e.test',
          phone: '+14155550123',
          business_name: 'Idempotent LLC',
          mcc: '5812',
          estimated_monthly_volume: 1000,
        })
        .expect(201);

      const replay = await asPartner(api().post('/v1/merchants'))
        .set('Idempotency-Key', key)
        .send({
          business_type: 'company',
          country: 'US',
          email: 'idem@e2e.test',
          phone: '+14155550123',
          business_name: 'Idempotent LLC',
          mcc: '5812',
          estimated_monthly_volume: 1000,
        })
        .expect(201);

      expect(replay.body.merchant_id).toBe(first.body.merchant_id);
      expect(await prisma.merchant.count({ where: { partnerId, contact: { path: ['email'], equals: 'idem@e2e.test' } } })).toBe(1);
    });
  });

  describe('progressive onboarding through activation', () => {
    it('walks a company from intake to an active account', async () => {
      const created = await createMerchant({ email: 'journey@e2e.test' }).expect(201);
      const merchantId: string = created.body.merchant_id;
      expect(created.body.status).toBe('pending');
      expect(created.body.required_steps).toEqual(
        expect.arrayContaining(['business_verification', 'bank_account_setup', 'owner_verification']),
      );

      await asPartner(api().post(`/v1/merchants/${merchantId}/business-verification`))
        .send({
          legal_name: 'E2E Coffee LLC',
          tax_id: '123456789',
          registration_number: 'C1234567',
          incorporation_date: '2019-04-01',
          incorporation_country: 'US',
          business_address: ADDRESS,
        })
        .expect(201);

      const owners = await asPartner(api().post(`/v1/merchants/${merchantId}/owners`))
        .send({
          owners: [
            {
              first_name: 'Ada',
              last_name: 'Lovelace',
              email: 'ada@e2e.test',
              date_of_birth: '1985-12-10',
              address: ADDRESS,
              ownership_percentage: 80,
              national_id_last4: '6789',
              is_control_prong: true,
            },
          ],
        })
        .expect(201);
      const ownerId: string = owners.body.data[0].id;

      const bank = await asPartner(api().post(`/v1/merchants/${merchantId}/bank-accounts`))
        .send({
          account_number: '000123456789',
          routing_number: '121000248',
          account_type: 'checking',
          currency: 'USD',
          country: 'US',
          account_holder_name: 'E2E Coffee LLC',
        })
        .expect(201);
      const bankAccountId: string = bank.body.id;
      expect(bank.body.account_number_last4).toBe('6789');
      expect(bank.body.routing_number_last4).toBe('0248');
      expect(JSON.stringify(bank.body)).not.toContain('000123456789');
      expect(JSON.stringify(bank.body)).not.toContain('121000248');

      const business = await asPartner(api().post('/v1/verify/business'))
        .send({ merchant_id: merchantId })
        .expect(201);
      expect(business.body.status).toBe('verified');

      await asPartner(api().post('/v1/verify/identity'))
        .send({
          merchant_id: merchantId,
          owner_id: ownerId,
          verification_method: 'database_check',
          consent: true,
        })
        .expect(201);

      const bankVerification = await asPartner(api().post('/v1/verify/bank-account'))
        .send({ merchant_id: merchantId, bank_account_id: bankAccountId })
        .expect(201);
      expect(bankVerification.body.status).toBe('verified');

      const status = await asPartner(api().get(`/v1/merchants/${merchantId}/status`)).expect(200);
      expect(
        status.body.steps.every((step: { status: string }) => step.status === 'completed'),
      ).toBe(true);
      expect(status.body.outstanding_actions).toEqual([]);
      expect(status.body.verifications).toHaveLength(3);

      const risk = await asPartner(api().post('/v1/risk/assess'))
        .send({ merchant_id: merchantId })
        .expect(201);
      expect(risk.body.risk_level).toBe('low');
      expect(risk.body.factors.length).toBeGreaterThan(0);

      const decision = await asPartner(api().post('/v1/underwriting/submit'))
        .send({ merchant_id: merchantId })
        .expect(201);
      expect(decision.body.decision).toBe('approved');
      expect(decision.body.processing_limits.monthly_volume_limit).toBeGreaterThan(0);
      expect(decision.body.pricing_tier).toBe('standard');

      const activated = await asPartner(api().post(`/v1/merchants/${merchantId}/activate`))
        .send({})
        .expect(201);
      expect(activated.body.status).toBe('active');

      const suspended = await asPartner(api().post(`/v1/merchants/${merchantId}/suspend`))
        .send({ reason: 'Merchant requested a pause in processing.' })
        .expect(201);
      expect(suspended.body.status).toBe('suspended');
    });

    it('blocks underwriting until onboarding is complete', async () => {
      const created = await createMerchant({ email: 'incomplete@e2e.test' }).expect(201);
      const response = await asPartner(api().post('/v1/underwriting/submit'))
        .send({ merchant_id: created.body.merchant_id })
        .expect(422);
      expect(response.body.error.type).toBe('validation_error');
    });

    it('declines prohibited categories automatically', async () => {
      const created = await createMerchant({
        email: 'prohibited@e2e.test',
        business_name: 'Lucky Bets',
        mcc: '7995',
        estimated_monthly_volume: 900_000,
      }).expect(201);

      const decision = await asPartner(api().post('/v1/underwriting/submit'))
        .send({ merchant_id: created.body.merchant_id, allow_incomplete: true })
        .expect(201);
      expect(decision.body.decision).toBe('declined');
      expect(decision.body.reason_codes).toContain('prohibited_business_category');
      expect(decision.body.risk_level).toBe('prohibited');
    });

    it('fails KYB for the sandbox registry-miss trigger and records the attempt', async () => {
      const created = await createMerchant({ email: 'kyb-fail@e2e.test' }).expect(201);
      const merchantId: string = created.body.merchant_id;

      await asPartner(api().post(`/v1/merchants/${merchantId}/business-verification`))
        .send({
          legal_name: 'TEST_KYB_NOT_FOUND Holdings',
          tax_id: '123456789',
          business_address: ADDRESS,
        })
        .expect(201);

      const verification = await asPartner(api().post('/v1/verify/business'))
        .send({ merchant_id: merchantId })
        .expect(201);
      expect(verification.body.status).toBe('failed');

      const history = await asPartner(api().get(`/v1/verify/merchants/${merchantId}`)).expect(200);
      expect(history.body.data[0]).toMatchObject({ verification_type: 'business', status: 'failed' });
    });

    it('requires consent for identity verification', async () => {
      const created = await createMerchant({ email: 'consent@e2e.test' }).expect(201);
      const owners = await asPartner(api().post(`/v1/merchants/${created.body.merchant_id}/owners`))
        .send({
          owners: [
            {
              first_name: 'Grace',
              last_name: 'Hopper',
              email: 'grace@e2e.test',
              date_of_birth: '1980-01-01',
              address: ADDRESS,
              ownership_percentage: 100,
            },
          ],
        })
        .expect(201);

      await asPartner(api().post('/v1/verify/identity'))
        .send({
          merchant_id: created.body.merchant_id,
          owner_id: owners.body.data[0].id,
          verification_method: 'database_check',
          consent: false,
        })
        .expect(400);
    });

    it('confirms micro-deposits before marking an account verified', async () => {
      const created = await createMerchant({ email: 'micro@e2e.test' }).expect(201);
      const merchantId: string = created.body.merchant_id;
      const bank = await asPartner(api().post(`/v1/merchants/${merchantId}/bank-accounts`))
        .send({
          account_number: '000987654321',
          routing_number: '121000248',
          account_type: 'checking',
          currency: 'USD',
          country: 'US',
          account_holder_name: 'E2E Coffee LLC',
          verification_method: 'micro_deposits',
        })
        .expect(201);

      const started = await asPartner(api().post('/v1/verify/bank-account'))
        .send({
          merchant_id: merchantId,
          bank_account_id: bank.body.id,
          verification_method: 'micro_deposits',
        })
        .expect(201);
      expect(started.body.status).toBe('in_progress');

      const wrong = await asPartner(api().post('/v1/verify/bank-account/confirm'))
        .send({ merchant_id: merchantId, bank_account_id: bank.body.id, amounts: [1, 2] })
        .expect(201);
      expect(wrong.body.status).toBe('failed');

      const account = await prisma.bankAccount.findFirst({ where: { reference: bank.body.id } });
      const amounts = (account?.microDeposits ?? []) as number[];
      const confirmed = await asPartner(api().post('/v1/verify/bank-account/confirm'))
        .send({ merchant_id: merchantId, bank_account_id: bank.body.id, amounts })
        .expect(201);
      expect(confirmed.body.status).toBe('verified');
    });
  });

  describe('compliance, webhooks and analytics', () => {
    it('returns country-specific requirements for smart forms', async () => {
      const us = await asPartner(
        api().get('/v1/compliance/requirements').query({ country: 'US', business_type: 'company' }),
      ).expect(200);
      const de = await asPartner(
        api().get('/v1/compliance/requirements').query({ country: 'DE', business_type: 'company' }),
      ).expect(200);

      expect(us.body.national_id_label).toBeTruthy();
      expect(de.body.region).toBe('EU');
      expect(de.body.regulations.join(' ')).toMatch(/GDPR|AMLD/);
      expect(de.body.default_currency).toBe('EUR');
    });

    it('registers webhooks, records deliveries and signs them', async () => {
      const webhook = await asPartner(api().post('/v1/webhooks'))
        .send({ url: 'http://127.0.0.1:9/hooks', events: ['merchant.created'] })
        .expect(201);
      expect(webhook.body.secret).toMatch(/^whsec_/);

      const merchant = await createMerchant({ email: `hooks-${Date.now()}@e2e.test` }).expect(201);

      // Delivery is persisted synchronously; the HTTP attempt itself is asynchronous.
      const deliveries = await asPartner(
        api().get(`/v1/webhooks/${webhook.body.id}/deliveries`),
      ).expect(200);
      expect(deliveries.body.data[0]).toMatchObject({ event_type: 'merchant.created' });
      expect(JSON.stringify(deliveries.body)).toContain(merchant.body.merchant_id);

      const listed = await asPartner(api().get('/v1/webhooks')).expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(webhook.body.secret);
    });

    it('reports funnel, risk and audit analytics for the partner', async () => {
      const funnel = await asPartner(api().get('/v1/analytics/onboarding')).expect(200);
      expect(funnel.body.total_applications).toBeGreaterThan(0);
      expect(funnel.body.step_completion.length).toBeGreaterThan(0);

      const risk = await asPartner(api().get('/v1/analytics/risk')).expect(200);
      expect(risk.body.assessments).toBeGreaterThan(0);

      const audit = await asPartner(api().get('/v1/analytics/audit-logs').query({ limit: 5 })).expect(200);
      expect(audit.body.data.length).toBeGreaterThan(0);
      expect(JSON.stringify(audit.body)).not.toContain('000123456789');
    });

    it('advertises both credential types on the published schema', async () => {
      const doc = await api().get('/docs/openapi.json').expect(200);
      expect(Object.keys(doc.body.components.securitySchemes).sort()).toEqual([
        'ApiKey',
        'OnboardingSession',
      ]);
      // Without a top-level requirement, Swagger UI's "Try it out" sends no credential.
      expect(doc.body.security).toEqual([{ ApiKey: [] }, { OnboardingSession: [] }]);
    });

    it('serves health probes without credentials', async () => {
      await api().get('/healthz').expect(200);
      await api().get('/readyz').expect(200);
    });
  });
});
