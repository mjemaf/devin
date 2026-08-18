import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { Harness, startHarness } from './harness';

const merchantPayload = {
  business_type: 'company',
  country: 'US',
  email: 'owner@acme.example.com',
  phone: '+14155550123',
  business_name: 'Acme Corp',
  mcc: '5734',
  estimated_monthly_volume: 50_000,
  products_sold: ['software'],
};

interface CapturedRequest {
  headers: Record<string, string | undefined>;
  body: string;
}

/** Minimal partner endpoint used to assert signed webhook delivery. */
function startReceiver(captured: CapturedRequest[]): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        captured.push({ headers: req.headers as Record<string, string | undefined>, body });
        res.writeHead(200).end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/hooks`, server });
    });
  });
}

describe('platform concerns (e2e)', () => {
  let harness: Harness;
  let api: () => request.Agent;

  beforeAll(async () => {
    harness = await startHarness();
    api = () => request(harness.app.getHttpServer());
  });

  afterAll(async () => {
    await harness.close();
  });

  const write = (path: string) => api().post(path).set('X-API-Key', harness.partner.operatorKey);

  describe('authentication', () => {
    it('rejects requests without credentials', async () => {
      const response = await api().post('/v1/merchants').send(merchantPayload).expect(401);
      expect(response.body.error).toMatchObject({
        type: 'authentication_error',
        code: 'invalid_credentials',
      });
      expect(response.body.error.request_id).toMatch(/^req_/);
    });

    it('rejects an unknown API key', async () => {
      await api()
        .post('/v1/merchants')
        .set('X-API-Key', 'sk_test_not_a_real_key')
        .send(merchantPayload)
        .expect(401);
    });

    it('accepts an API key presented as a bearer token', async () => {
      await api()
        .get('/v1/merchants')
        .set('Authorization', `Bearer ${harness.partner.viewerKey}`)
        .expect(200);
    });

    it('issues and accepts OAuth 2.0 client-credentials tokens', async () => {
      const token = await api()
        .post('/v1/oauth/token')
        .send({
          grant_type: 'client_credentials',
          client_id: harness.partner.partnerId,
          client_secret: harness.partner.operatorKey,
        })
        .expect(201);
      expect(token.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read write' });

      await api()
        .get('/v1/merchants')
        .set('Authorization', `Bearer ${token.body.access_token}`)
        .expect(200);
    });

    it('refuses a token request whose client_id does not match the secret', async () => {
      await api()
        .post('/v1/oauth/token')
        .send({
          grant_type: 'client_credentials',
          client_id: harness.otherPartner.partnerId,
          client_secret: harness.partner.operatorKey,
        })
        .expect(401);
    });
  });

  describe('authorisation', () => {
    it('enforces the write scope', async () => {
      const response = await api()
        .post('/v1/merchants')
        .set('X-API-Key', harness.partner.viewerKey)
        .send(merchantPayload)
        .expect(403);
      expect(response.body.error).toMatchObject({
        type: 'authorization_error',
        code: 'insufficient_scope',
      });
    });

    it('enforces the admin scope for privileged operations', async () => {
      const created = await write('/v1/merchants').send(merchantPayload).expect(201);
      await api()
        .post(`/v1/merchants/${created.body.id}/suspend`)
        .set('X-API-Key', harness.partner.operatorKey)
        .send({ reason: 'chargeback spike' })
        .expect(403);
      await api()
        .post(`/v1/merchants/${created.body.id}/suspend`)
        .set('X-API-Key', harness.partner.adminKey)
        .send({ reason: 'chargeback spike' })
        .expect(201);
    });
  });

  describe('partner isolation', () => {
    it('hides another partner’s merchant', async () => {
      const created = await write('/v1/merchants').send(merchantPayload).expect(201);

      const response = await api()
        .get(`/v1/merchants/${created.body.id}`)
        .set('X-API-Key', harness.otherPartner.adminKey)
        .expect(404);
      expect(response.body.error.type).toBe('not_found_error');

      const list = await api()
        .get('/v1/merchants')
        .set('X-API-Key', harness.otherPartner.viewerKey)
        .expect(200);
      expect(list.body.data).toEqual([]);
    });
  });

  describe('validation', () => {
    it('returns the documented error envelope for a bad payload', async () => {
      const response = await write('/v1/merchants')
        .send({ ...merchantPayload, mcc: 'retail' })
        .expect(400);
      expect(response.body.error).toMatchObject({
        type: 'validation_error',
        code: 'invalid_request_parameter',
        param: 'mcc',
      });
    });

    it('uses the envelope for framework-level failures too', async () => {
      const missing = await api()
        .get('/v1/no-such-route')
        .set('X-API-Key', harness.partner.viewerKey)
        .expect(404);
      expect(missing.body.error).toMatchObject({
        type: 'not_found_error',
        code: 'resource_not_found',
      });
      expect(typeof missing.body.error.message).toBe('string');

      const malformed = await api()
        .post('/v1/merchants')
        .set('X-API-Key', harness.partner.operatorKey)
        .set('Content-Type', 'application/json')
        .send('{"business_name":')
        .expect(400);
      expect(malformed.body.error).toMatchObject({ type: 'validation_error' });
      expect(malformed.body.error.request_id).toMatch(/^req_/);
    });

    it('rejects unknown properties', async () => {
      await write('/v1/merchants')
        .send({ ...merchantPayload, unexpected_field: true })
        .expect(400);
    });
  });

  describe('idempotency', () => {
    it('replays the original response for a repeated key', async () => {
      const key = `idem_${Date.now()}`;
      const first = await write('/v1/merchants').set('Idempotency-Key', key).send(merchantPayload);
      const second = await write('/v1/merchants').set('Idempotency-Key', key).send(merchantPayload);

      expect(first.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(await harness.prisma.merchant.count({ where: { id: first.body.id } })).toBe(1);
    });

    it('rejects reuse of a key with a different payload', async () => {
      const key = `idem_conflict_${Date.now()}`;
      await write('/v1/merchants').set('Idempotency-Key', key).send(merchantPayload).expect(201);

      const conflict = await write('/v1/merchants')
        .set('Idempotency-Key', key)
        .send({ ...merchantPayload, business_name: 'Different Corp' })
        .expect(409);
      expect(conflict.body.error.code).toBe('idempotency_key_reused');
    });
  });

  describe('webhooks', () => {
    it('delivers HMAC-signed events to registered endpoints', async () => {
      const captured: CapturedRequest[] = [];
      const { url, server } = await startReceiver(captured);

      try {
        const webhook = await write('/v1/webhooks')
          .send({ url, events: ['merchant.created'] })
          .expect(201);
        expect(webhook.body.secret).toMatch(/^whsec_/);

        const created = await write('/v1/merchants').send(merchantPayload).expect(201);

        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(captured).toHaveLength(1);

        const delivery = captured[0];
        const envelope = JSON.parse(delivery.body);
        expect(envelope).toMatchObject({
          event_type: 'merchant.created',
          data: { merchant_id: created.body.id },
        });

        const expected = createHmac('sha256', webhook.body.secret)
          .update(`${delivery.headers['x-webhook-timestamp']}.${delivery.body}`)
          .digest('hex');
        expect(delivery.headers['x-webhook-signature']).toBe(`v1=${expected}`);

        const deliveries = await api()
          .get(`/v1/webhooks/${webhook.body.id}/deliveries`)
          .set('X-API-Key', harness.partner.viewerKey)
          .expect(200);
        expect(deliveries.body.data[0]).toMatchObject({
          event_type: 'merchant.created',
          status: 'delivered',
          response_code: 200,
        });

        await api()
          .delete(`/v1/webhooks/${webhook.body.id}`)
          .set('X-API-Key', harness.partner.operatorKey)
          .expect(200);
      } finally {
        server.close();
      }
    });

    it('does not deliver events a partner did not subscribe to', async () => {
      const captured: CapturedRequest[] = [];
      const { url, server } = await startReceiver(captured);

      try {
        await write('/v1/webhooks').send({ url, events: ['merchant.activated'] }).expect(201);
        await write('/v1/merchants').send(merchantPayload).expect(201);
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(captured).toHaveLength(0);
      } finally {
        server.close();
      }
    });
  });

  describe('documents', () => {
    it('stores document metadata and rejects oversized uploads', async () => {
      const created = await write('/v1/merchants').send(merchantPayload).expect(201);

      const document = await write(`/v1/merchants/${created.body.id}/documents`)
        .send({
          document_type: 'business_license',
          file_name: 'license.pdf',
          content_type: 'application/pdf',
          file_content: Buffer.from('%PDF-1.4 sandbox license').toString('base64'),
        })
        .expect(201);
      expect(document.body).toMatchObject({
        document_type: 'business_license',
        content_type: 'application/pdf',
      });

      const list = await api()
        .get(`/v1/merchants/${created.body.id}/documents`)
        .set('X-API-Key', harness.partner.viewerKey)
        .expect(200);
      expect(list.body.data).toHaveLength(1);

      const oversized = await write(`/v1/merchants/${created.body.id}/documents`)
        .send({
          document_type: 'bank_statement',
          file_name: 'big.pdf',
          content_type: 'application/pdf',
          file_content: Buffer.alloc(11 * 1024 * 1024, 1).toString('base64'),
        })
        .expect(400);
      expect(oversized.body.error.code).toBe('document_too_large');
    });
  });

  describe('service metadata', () => {
    it('exposes health and supported countries without credentials', async () => {
      await api().get('/v1/health').expect(200, { status: 'ok', database: 'ok', version: 'v1' });

      const countries = await api().get('/v1/supported-countries').expect(200);
      expect(countries.body.data).toContain('US');
      expect(countries.body.data).not.toContain('IR');
    });
  });
});
