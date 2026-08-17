import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Webhook } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { newId } from '../common/ids';
import { signPayload } from '../common/crypto.util';
import { WebhookEvent } from './webhook-events';

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

export interface WebhookEnvelope {
  id: string;
  event_type: WebhookEvent;
  data: Record<string, unknown>;
  created_at: string;
}

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  buildEnvelope(eventType: WebhookEvent, data: Record<string, unknown>): WebhookEnvelope {
    return {
      id: newId('event'),
      event_type: eventType,
      data,
      created_at: new Date().toISOString(),
    };
  }

  /** Posts the event with an HMAC signature, retrying transient failures with backoff. */
  async deliver(webhook: Webhook, envelope: WebhookEnvelope): Promise<void> {
    const body = JSON.stringify(envelope);
    const timeoutMs = this.config.get<number>('webhookTimeoutMs') ?? 5000;

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        id: newId('delivery'),
        webhookId: webhook.id,
        eventId: envelope.id,
        eventType: envelope.event_type,
        payload: envelope as unknown as Prisma.InputJsonValue,
        status: 'pending',
      },
    });

    let lastError: string | undefined;
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const timestamp = Math.floor(Date.now() / 1000);
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Id': envelope.id,
            'X-Webhook-Timestamp': String(timestamp),
            'X-Webhook-Signature': `v1=${signPayload(webhook.secret, timestamp, body)}`,
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        lastStatus = response.status;

        if (response.ok) {
          await this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'delivered',
              attempts: attempt,
              responseCode: response.status,
              deliveredAt: new Date(),
            },
          });
          return;
        }
        lastError = `Endpoint responded with ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'unknown transport error';
      }

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1)));
      }
    }

    this.logger.warn(
      { webhookId: webhook.id, eventId: envelope.id, lastError },
      'webhook_delivery_failed',
    );
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'failed',
        attempts: MAX_ATTEMPTS,
        responseCode: lastStatus ?? null,
        errorMessage: lastError,
      },
    });
  }
}
