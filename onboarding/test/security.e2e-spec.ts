import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  BASE,
  TestPartner,
  businessDetailsPayload,
  createPartner,
  createTestApp,
  merchantPayload,
} from './app.factory';

describe('Authentication, authorization, and isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let partner: TestPartner;
  let otherPartner: TestPartner;
  let viewer: TestPartner;
  let merchantId: string;
  let onboardingToken: string;

  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    partner = await createPartner(prisma);
    otherPartner = await createPartner(prisma);
    viewer = await createPartner(prisma, { role: 'viewer' });

    const created = await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer(partner.apiKey))
      .send(merchantPayload())
      .expect(201);
    merchantId = created.body.merchant_id;
    onboardingToken = created.body.onboarding_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('leaves the health probe public', async () => {
    await request(app.getHttpServer()).get(`${BASE}/health`).expect(200);
  });

  it('rejects unauthenticated and invalid credentials with the documented envelope', async () => {
    const missing = await request(app.getHttpServer()).get(`${BASE}/merchants`).expect(401);
    expect(missing.body.error).toMatchObject({
      type: 'authentication_error',
      code: 'missing_api_key',
    });
    expect(missing.body.error.request_id).toMatch(/^req_/);

    await request(app.getHttpServer())
      .get(`${BASE}/merchants`)
      .set(bearer('sk_sandbox_not_a_real_key'))
      .expect(401);
  });

  it('accepts the api key through the X-Api-Key header', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/merchants`)
      .set('X-Api-Key', partner.apiKey)
      .expect(200);
  });

  it('rejects revoked api keys', async () => {
    const revoked = await createPartner(prisma);
    await prisma.apiKey.updateMany({ data: { revokedAt: new Date() } });
    await request(app.getHttpServer())
      .get(`${BASE}/merchants`)
      .set(bearer(revoked.apiKey))
      .expect(401);
    await prisma.apiKey.updateMany({ data: { revokedAt: null } });
  });

  it('enforces scopes per role', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/merchants`)
      .set(bearer(viewer.apiKey))
      .expect(200);

    const forbidden = await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer(viewer.apiKey))
      .send(merchantPayload())
      .expect(403);
    expect(forbidden.body.error.type).toBe('authorization_error');
  });

  it('isolates merchants between partners', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/merchants/${merchantId}`)
      .set(bearer(otherPartner.apiKey))
      .expect(404);

    const list = await request(app.getHttpServer())
      .get(`${BASE}/merchants`)
      .set(bearer(otherPartner.apiKey))
      .expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('scopes onboarding tokens to a single merchant', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/merchants/${merchantId}`)
      .set(bearer(onboardingToken))
      .expect(200);

    const other = await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer(partner.apiKey))
      .send(merchantPayload({ email: 'second@example.com' }))
      .expect(201);

    await request(app.getHttpServer())
      .get(`${BASE}/merchants/${other.body.merchant_id}`)
      .set(bearer(onboardingToken))
      .expect(403);
  });

  it('validates request payloads and reports the offending parameter', async () => {
    const response = await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer(partner.apiKey))
      .send(merchantPayload({ mcc: '58', email: 'not-an-email' }))
      .expect(400);
    expect(response.body.error).toMatchObject({
      type: 'validation_error',
      code: 'invalid_request_parameter',
    });
    expect(response.body.error.param).toBeDefined();
  });

  it('requires explicit consent before verifying an individual', async () => {
    const response = await request(app.getHttpServer())
      .post(`${BASE}/verify/identity`)
      .set(bearer(partner.apiKey))
      .send({ merchant_id: merchantId, owner_id: 'owner_missing', consent: false })
      .expect(400);
    expect(response.body.error.message).toContain('consent');
  });

  it('replays responses for a repeated idempotency key and rejects payload reuse', async () => {
    const key = `idem-${Date.now()}`;
    const payload = merchantPayload({ email: 'idempotent@example.com' });

    const first = await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer(partner.apiKey))
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer(partner.apiKey))
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    expect(replay.body.merchant_id).toBe(first.body.merchant_id);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const conflict = await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer(partner.apiKey))
      .set('Idempotency-Key', key)
      .send(merchantPayload({ email: 'different@example.com' }))
      .expect(409);
    expect(conflict.body.error.code).toBe('idempotency_key_reuse');
  });

  it('never returns raw tax ids or account numbers', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/merchants/${merchantId}/business-verification`)
      .set(bearer(partner.apiKey))
      .send(businessDetailsPayload())
      .expect(200);

    const merchant = await request(app.getHttpServer())
      .get(`${BASE}/merchants/${merchantId}`)
      .set(bearer(partner.apiKey))
      .expect(200);
    expect(JSON.stringify(merchant.body)).not.toContain('12-3456789');

    const stored = await prisma.merchant.findFirstOrThrow({ where: { publicId: merchantId } });
    expect(JSON.stringify(stored.businessProfile)).not.toContain('12-3456789');
  });

  it('writes an audit trail for mutating requests', async () => {
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { publicId: merchantId } });
    const logs = await prisma.auditLog.findMany({ where: { merchantId: merchant.id } });
    expect(logs.map((log) => log.action)).toContain('merchant.created');
    expect(logs.every((log) => log.actorId.length > 0)).toBe(true);
  });

  it('returns a not_found envelope for unknown merchants', async () => {
    const response = await request(app.getHttpServer())
      .get(`${BASE}/merchants/mer_doesnotexist`)
      .set(bearer(partner.apiKey))
      .expect(404);
    expect(response.body.error.type).toBe('not_found_error');
  });
});
