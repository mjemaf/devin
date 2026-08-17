import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/auth/auth-context.decorator';
import { AuthContext } from '../../common/auth/auth.types';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequireScopes('webhooks:write')
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  async register(@CurrentAuth() auth: AuthContext, @Body() dto: CreateWebhookDto) {
    const { webhook, secret } = await this.webhooks.register(auth.partnerId, dto);
    await this.audit.record(auth, {
      action: 'webhook.registered',
      resourceType: 'webhook',
      resourceId: webhook.publicId,
      changes: { url: webhook.url, events: webhook.events },
    });
    return {
      id: webhook.publicId,
      url: webhook.url,
      events: webhook.events,
      secret,
      is_active: webhook.isActive,
      created_at: webhook.createdAt.toISOString(),
    };
  }

  @Get()
  @RequireScopes('webhooks:write')
  @ApiOperation({ summary: 'List registered webhook endpoints' })
  async list(@CurrentAuth() auth: AuthContext) {
    const webhooks = await this.webhooks.list(auth.partnerId);
    return {
      data: webhooks.map((webhook) => ({
        id: webhook.publicId,
        url: webhook.url,
        events: webhook.events,
        is_active: webhook.isActive,
        created_at: webhook.createdAt.toISOString(),
      })),
    };
  }

  @Get(':webhook_id/deliveries')
  @RequireScopes('webhooks:write')
  @ApiOperation({ summary: 'Inspect recent delivery attempts for an endpoint' })
  async deliveries(@CurrentAuth() auth: AuthContext, @Param('webhook_id') webhookId: string) {
    const deliveries = await this.webhooks.deliveries(auth.partnerId, webhookId);
    return {
      data: deliveries.map((delivery) => ({
        id: delivery.publicId,
        event_id: delivery.eventId,
        event_type: delivery.eventType,
        status: delivery.status,
        attempts: delivery.attempts,
        response_code: delivery.responseCode,
        error: delivery.error,
        created_at: delivery.createdAt.toISOString(),
        delivered_at: delivery.deliveredAt?.toISOString() ?? null,
      })),
    };
  }

  @Delete(':webhook_id')
  @HttpCode(200)
  @RequireScopes('webhooks:write')
  @ApiOperation({ summary: 'Deactivate a webhook endpoint' })
  async deactivate(@CurrentAuth() auth: AuthContext, @Param('webhook_id') webhookId: string) {
    const webhook = await this.webhooks.deactivate(auth.partnerId, webhookId);
    await this.audit.record(auth, {
      action: 'webhook.deactivated',
      resourceType: 'webhook',
      resourceId: webhook.publicId,
    });
    return { id: webhook.publicId, is_active: webhook.isActive };
  }
}
