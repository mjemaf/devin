import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthContext, CurrentAuth } from '../auth/auth-context';
import { RequireScopes } from '../auth/decorators';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  @RequireScopes('write')
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateWebhookDto) {
    return this.webhooks.create(auth.partnerId, dto);
  }

  @Get()
  @RequireScopes('read')
  @ApiOperation({ summary: 'List registered webhook endpoints' })
  list(@CurrentAuth() auth: AuthContext) {
    return this.webhooks.list(auth.partnerId);
  }

  @Delete(':webhookId')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  remove(@CurrentAuth() auth: AuthContext, @Param('webhookId') webhookId: string) {
    return this.webhooks.remove(auth.partnerId, webhookId);
  }

  @Get(':webhookId/deliveries')
  @RequireScopes('read')
  @ApiOperation({ summary: 'Inspect recent delivery attempts for a webhook endpoint' })
  deliveries(@CurrentAuth() auth: AuthContext, @Param('webhookId') webhookId: string) {
    return this.webhooks.listDeliveries(auth.partnerId, webhookId);
  }
}
