import { Injectable } from '@nestjs/common';
import { Webhook } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomToken } from '../../common/util/crypto';
import { newReference } from '../../common/util/references';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(principal: Principal, dto: CreateWebhookDto, context: RequestContext) {
    const secret = dto.secret ?? `whsec_${randomToken(24)}`;
    const webhook = await this.prisma.webhook.create({
      data: {
        reference: newReference('webhook'),
        partnerId: principal.partnerId,
        url: dto.url,
        events: dto.events,
        secret,
      },
    });

    await this.audit.record(
      principal,
      {
        action: 'webhook.created',
        resourceType: 'webhook',
        resourceId: webhook.reference,
        changes: { url: dto.url, events: dto.events },
      },
      context,
    );

    return { ...this.serialize(webhook), secret };
  }

  async list(principal: Principal) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { partnerId: principal.partnerId },
      orderBy: { createdAt: 'desc' },
    });
    return { data: webhooks.map((webhook) => this.serialize(webhook)) };
  }

  async update(
    principal: Principal,
    reference: string,
    dto: UpdateWebhookDto,
    context: RequestContext,
  ) {
    const webhook = await this.require(principal, reference);
    const updated = await this.prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        url: dto.url ?? webhook.url,
        events: dto.events ?? webhook.events,
        isActive: dto.is_active ?? webhook.isActive,
      },
    });

    await this.audit.record(
      principal,
      {
        action: 'webhook.updated',
        resourceType: 'webhook',
        resourceId: reference,
        changes: { ...dto },
      },
      context,
    );

    return this.serialize(updated);
  }

  async remove(principal: Principal, reference: string, context: RequestContext) {
    const webhook = await this.require(principal, reference);
    await this.prisma.webhook.delete({ where: { id: webhook.id } });
    await this.audit.record(
      principal,
      { action: 'webhook.deleted', resourceType: 'webhook', resourceId: reference },
      context,
    );
    return { reference, deleted: true };
  }

  async deliveries(principal: Principal, reference: string, limit: number) {
    const webhook = await this.require(principal, reference);
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { webhookId: webhook.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      data: deliveries.map((delivery) => ({
        id: delivery.id,
        event_id: delivery.eventId,
        event_type: delivery.eventType,
        status: delivery.status,
        attempts: delivery.attempts,
        response_code: delivery.responseCode,
        error_message: delivery.errorMessage,
        next_attempt_at: delivery.nextAttemptAt,
        delivered_at: delivery.deliveredAt,
        created_at: delivery.createdAt,
        payload: delivery.payload,
      })),
    };
  }

  private async require(principal: Principal, reference: string): Promise<Webhook> {
    const webhook = await this.prisma.webhook.findFirst({
      where: { reference, partnerId: principal.partnerId },
    });
    if (!webhook) {
      throw ApiException.notFound('webhook_not_found', `No webhook found with reference ${reference}.`);
    }
    return webhook;
  }

  private serialize(webhook: Webhook) {
    return {
      id: webhook.reference,
      url: webhook.url,
      events: webhook.events,
      is_active: webhook.isActive,
      created_at: webhook.createdAt,
      updated_at: webhook.updatedAt,
    };
  }
}
