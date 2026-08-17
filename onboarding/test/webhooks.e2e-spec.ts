import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { webhookSignature } from '../src/common/crypto.util';
import { newPublicId } from '../src/common/ids';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { BASE, TestPartner, createPartner, createTestApp, merchantPayload } from './app.factory';

interface CapturedRequest {
  body: string;
  headers: Record<string, string | undefined>;
}

/** Local receiver standing in for a partner endpoint. */
function startReceiver(
  captured: CapturedRequest[],
  statusFor: (attempt: number) => number,
): Promise<Server> {
  let attempts = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      attempts += 1;
      captured.push({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: req.headers as Record<string, string | undefined>,
      });
      res.writeHead(statusFor(attempts)).end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const urlFor = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for webhook delivery');
}

describe('Webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let partner: TestPartner;
  const servers: Server[] = [];

  const bearer = () => ({ Authorization: `Bearer ${partner.apiKey}` });

  /**
   * Endpoints are created directly so the receiver can listen on plain HTTP; the
   * public API only accepts HTTPS URLs (covered separately below).
   */
  async function registerEndpoint(url: string, secret: string): Promise<string> {
    const webhook = await prisma.webhook.create({
      data: {
        publicId: newPublicId('wh'),
        partnerId: partner.partnerId,
        url,
        secret,
        events: ['merchant.created'],
      },
    });
    return webhook.publicId;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    partner = await createPartner(prisma);
  });

  afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((r) => server.close(r))));
    await app.close();
  });

  it('rejects non-HTTPS endpoints and returns the secret once on registration', async () => {
    const rejected = await request(app.getHttpServer())
      .post(`${BASE}/webhooks`)
      .set(bearer())
      .send({ url: 'http://insecure.example.com/hook', events: ['merchant.created'] })
      .expect(400);
    expect(rejected.body.error.type).toBe('validation_error');

    const created = await request(app.getHttpServer())
      .post(`${BASE}/webhooks`)
      .set(bearer())
      .send({ url: 'https://partner.example.com/hook', events: ['merchant.created'] })
      .expect(201);
    expect(created.body.id).toMatch(/^wh_/);
    expect(created.body.secret).toMatch(/^whsec_[0-9a-f]{48}$/);

    const listed = await request(app.getHttpServer())
      .get(`${BASE}/webhooks`)
      .set(bearer())
      .expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.secret);

    await request(app.getHttpServer())
      .delete(`${BASE}/webhooks/${created.body.id}`)
      .set(bearer())
      .expect(200);
  });

  it('signs deliveries over the timestamp and body, and records them', async () => {
    const captured: CapturedRequest[] = [];
    const server = await startReceiver(captured, () => 200);
    servers.push(server);
    const webhookId = await registerEndpoint(urlFor(server), 'whsec_test_secret_value');

    await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer())
      .send(merchantPayload({ email: 'webhook@example.com' }))
      .expect(201);

    await waitFor(() => captured.length > 0);
    const delivery = captured[0];
    const timestamp = Number(delivery.headers['x-webhook-timestamp']);
    expect(delivery.headers['x-webhook-signature']).toBe(
      `v1=${webhookSignature('whsec_test_secret_value', timestamp, delivery.body)}`,
    );
    const envelope = JSON.parse(delivery.body);
    expect(envelope).toMatchObject({ event_type: 'merchant.created' });
    expect(envelope.id).toMatch(/^evt_/);
    expect(envelope.data.merchant_id).toMatch(/^mer_/);

    const deliveries = await request(app.getHttpServer())
      .get(`${BASE}/webhooks/${webhookId}/deliveries`)
      .set(bearer())
      .expect(200);
    expect(deliveries.body.data[0]).toMatchObject({
      status: 'delivered',
      event_type: 'merchant.created',
      response_code: 200,
    });

    await prisma.webhook.updateMany({ where: { publicId: webhookId }, data: { isActive: false } });
  });

  it('retries a failing endpoint until it succeeds', async () => {
    const captured: CapturedRequest[] = [];
    const server = await startReceiver(captured, (attempt) => (attempt < 2 ? 500 : 200));
    servers.push(server);
    const webhookId = await registerEndpoint(urlFor(server), 'whsec_retry_secret_value');

    await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer())
      .send(merchantPayload({ email: 'retry@example.com' }))
      .expect(201);

    await waitFor(() => captured.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const deliveries = await request(app.getHttpServer())
      .get(`${BASE}/webhooks/${webhookId}/deliveries`)
      .set(bearer())
      .expect(200);
    expect(deliveries.body.data[0].attempts).toBeGreaterThan(1);
    expect(deliveries.body.data[0].status).toBe('delivered');

    await prisma.webhook.updateMany({ where: { publicId: webhookId }, data: { isActive: false } });
  });

  it('stops delivering to a deactivated endpoint', async () => {
    const captured: CapturedRequest[] = [];
    const server = await startReceiver(captured, () => 200);
    servers.push(server);
    const webhookId = await registerEndpoint(urlFor(server), 'whsec_disabled_secret_value');
    await prisma.webhook.updateMany({ where: { publicId: webhookId }, data: { isActive: false } });

    await request(app.getHttpServer())
      .post(`${BASE}/merchants`)
      .set(bearer())
      .send(merchantPayload({ email: 'deactivated@example.com' }))
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(captured).toHaveLength(0);
  });
});
