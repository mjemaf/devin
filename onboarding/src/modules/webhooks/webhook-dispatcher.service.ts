import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newPublicId } from '../../common/ids';
import { webhookSignature } from '../../common/crypto.util';
import { WebhookEventType } from './webhook-events';

const MAX_ATTEMPTS = 3;
const DELIVERY_TIMEOUT_MS = 5_000;

export interface WebhookEnvelope {
  id: string;
  event_type: WebhookEventType;
  data: Record<string, unknown>;
  created_at: string;
}

/**
 * Fans an event out to every subscribed endpoint of a partner. Delivery rows are
 * persisted first so a failed POST can be retried/replayed independently of the
 * request that produced the event.
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emit(
    partnerId: string,
    eventType: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<WebhookEnvelope> {
    const envelope: WebhookEnvelope = {
      id: newPublicId('evt'),
      event_type: eventType,
      data,
      created_at: new Date().toISOString(),
    };

    const webhooks = await this.prisma.webhook.findMany({
      where: { partnerId, isActive: true, events: { has: eventType } },
    });

    for (const webhook of webhooks) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          publicId: newPublicId('whd'),
          webhookId: webhook.id,
          eventId: envelope.id,
          eventType,
          payload: envelope as unknown as Prisma.InputJsonValue,
        },
      });
      void this.deliver(delivery.id, webhook.url, webhook.secret, envelope);
    }

    return envelope;
  }

  /** Attempts delivery with bounded exponential backoff, recording the outcome. */
  private async deliver(
    deliveryId: string,
    url: string,
    secret: string,
    envelope: WebhookEnvelope,
  ): Promise<void> {
    const body = JSON.stringify(envelope);
    let lastError = 'delivery not attempted';
    let responseCode: number | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-id': envelope.id,
            'x-webhook-timestamp': String(timestamp),
            'x-webhook-signature': `v1=${webhookSignature(secret, timestamp, body)}`,
          },
          body,
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        });
        responseCode = response.status;
        if (response.ok) {
          await this.prisma.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
              status: WebhookDeliveryStatus.delivered,
              attempts: attempt,
              responseCode,
              deliveredAt: new Date(),
            },
          });
          return;
        }
        lastError = `endpoint responded ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'unknown delivery error';
      }
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
    }

    this.logger.warn({ deliveryId, url, lastError }, 'Webhook delivery failed');
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.failed,
        attempts: MAX_ATTEMPTS,
        responseCode,
        error: lastError,
      },
    });
  }
}
