import { Injectable } from '@nestjs/common';
import { Webhook } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { newId, newSecret } from '../common/ids';
import { ApiException } from '../common/errors/api.exception';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookEvent } from './webhook-events';
import { CreateWebhookDto } from './dto/create-webhook.dto';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  async create(partnerId: string, dto: CreateWebhookDto) {
    const webhook = await this.prisma.webhook.create({
      data: {
        id: newId('webhook'),
        partnerId,
        url: dto.url,
        events: dto.events,
        secret: dto.secret ?? newSecret('whsec'),
      },
    });
    return this.serialise(webhook, { includeSecret: true });
  }

  async list(partnerId: string) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
    });
    return { data: webhooks.map((webhook) => this.serialise(webhook)) };
  }

  async remove(partnerId: string, webhookId: string) {
    const webhook = await this.prisma.webhook.findFirst({ where: { id: webhookId, partnerId } });
    if (!webhook) throw ApiException.notFound('webhook', webhookId);
    await this.prisma.webhook.delete({ where: { id: webhook.id } });
    return { id: webhook.id, deleted: true };
  }

  async listDeliveries(partnerId: string, webhookId: string) {
    const webhook = await this.prisma.webhook.findFirst({ where: { id: webhookId, partnerId } });
    if (!webhook) throw ApiException.notFound('webhook', webhookId);
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      data: deliveries.map((item) => ({
        id: item.id,
        event_id: item.eventId,
        event_type: item.eventType,
        status: item.status,
        attempts: item.attempts,
        response_code: item.responseCode,
        error_message: item.errorMessage,
        created_at: item.createdAt,
        delivered_at: item.deliveredAt,
      })),
    };
  }

  /**
   * Fan-out to every subscribed endpoint. Delivery is intentionally fire-and-forget so
   * that a slow partner endpoint cannot slow down the API response.
   */
  async publish(
    partnerId: string,
    eventType: WebhookEvent,
    data: Record<string, unknown>,
  ): Promise<void> {
    const webhooks = await this.prisma.webhook.findMany({
      where: { partnerId, isActive: true, events: { has: eventType } },
    });
    if (webhooks.length === 0) return;

    const envelope = this.delivery.buildEnvelope(eventType, data);
    await Promise.all(
      webhooks.map((webhook) => this.delivery.deliver(webhook, envelope).catch(() => undefined)),
    );
  }

  private serialise(webhook: Webhook, options: { includeSecret?: boolean } = {}) {
    return {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      is_active: webhook.isActive,
      created_at: webhook.createdAt,
      ...(options.includeSecret ? { secret: webhook.secret } : {}),
    };
  }
}
