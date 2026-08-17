import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hmacSha256 } from '../../common/util/crypto';
import { newReference } from '../../common/util/references';
import { WebhookEvent } from './events';

const RETRY_SWEEP_MS = 15_000;

/**
 * Fan-out plus at-least-once retry for partner webhooks. Deliveries are persisted
 * before the HTTP attempt so a crash mid-flight is retried rather than lost.
 */
@Injectable()
export class WebhookDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('nodeEnv') === 'test') {
      return;
    }
    this.sweeper = setInterval(() => {
      void this.retryDue();
    }, RETRY_SWEEP_MS);
    this.sweeper.unref();
  }

  onModuleDestroy(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
    }
  }

  /** Queues one delivery per subscribed endpoint and attempts them immediately. */
  async emit(
    partnerId: string,
    eventType: WebhookEvent,
    data: Record<string, unknown>,
  ): Promise<string> {
    const eventId = newReference('event');
    const webhooks = await this.prisma.webhook.findMany({
      where: { partnerId, isActive: true, events: { has: eventType } },
    });

    const payload = {
      id: eventId,
      event_type: eventType,
      data,
      created_at: new Date().toISOString(),
    };

    for (const webhook of webhooks) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          eventId,
          eventType,
          payload: payload as unknown as Prisma.InputJsonValue,
          status: 'pending',
        },
      });
      void this.attempt(delivery.id).catch((error) =>
        this.logger.warn({ err: error, deliveryId: delivery.id }, 'webhook_attempt_failed'),
      );
    }

    return eventId;
  }

  async attempt(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });
    if (!delivery || delivery.status === 'delivered') {
      return;
    }

    const maxAttempts = this.config.get<number>('webhookMaxAttempts') ?? 5;
    const timeoutMs = this.config.get<number>('webhookTimeoutMs') ?? 5000;
    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = hmacSha256(delivery.webhook.secret, `${timestamp}.${body}`);
    const attempts = delivery.attempts + 1;

    try {
      const response = await fetch(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-onboarding-event': delivery.eventType,
          'x-onboarding-event-id': delivery.eventId,
          'x-onboarding-signature': `t=${timestamp},v1=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'delivered',
            attempts,
            responseCode: response.status,
            deliveredAt: new Date(),
            nextAttemptAt: null,
            errorMessage: null,
          },
        });
        return;
      }

      await this.fail(delivery.id, attempts, maxAttempts, response.status, `HTTP ${response.status}`);
    } catch (error) {
      await this.fail(
        delivery.id,
        attempts,
        maxAttempts,
        null,
        error instanceof Error ? error.message : 'delivery_error',
      );
    }
  }

  async retryDue(limit = 50): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
      take: limit,
      orderBy: { nextAttemptAt: 'asc' },
    });
    for (const delivery of due) {
      await this.attempt(delivery.id);
    }
    return due.length;
  }

  private async fail(
    deliveryId: string,
    attempts: number,
    maxAttempts: number,
    responseCode: number | null,
    errorMessage: string,
  ): Promise<void> {
    const exhausted = attempts >= maxAttempts;
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: exhausted ? 'failed' : 'pending',
        attempts,
        responseCode,
        errorMessage,
        // Exponential backoff: 30s, 2m, 8m, 32m.
        nextAttemptAt: exhausted
          ? null
          : new Date(Date.now() + 30_000 * Math.pow(4, attempts - 1)),
      },
    });
  }
}
