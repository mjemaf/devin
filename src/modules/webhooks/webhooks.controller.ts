import { Controller, Post, Get, Delete, Body, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register webhook endpoint' })
  @ApiResponse({ status: 201, description: 'Webhook registered successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async registerWebhook(
    @Body() body: { url: string; events: string[]; secret?: string },
    @Headers('x-partner-id') partnerId: string,
  ) {
    if (!partnerId) {
      throw new Error('X-Partner-ID header is required');
    }
    return this.webhooksService.registerWebhook(partnerId, body.url, body.events, body.secret);
  }

  @Get()
  @ApiOperation({ summary: 'Get all webhooks for partner' })
  @ApiResponse({ status: 200, description: 'Webhooks retrieved' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async getWebhooks(@Headers('x-partner-id') partnerId: string) {
    if (!partnerId) {
      throw new Error('X-Partner-ID header is required');
    }
    return this.webhooksService.getWebhooks(partnerId);
  }

  @Delete(':webhookId')
  @ApiOperation({ summary: 'Delete webhook' })
  @ApiResponse({ status: 200, description: 'Webhook deleted' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async deleteWebhook(
    @Param('webhookId') webhookId: string,
    @Headers('x-partner-id') partnerId: string,
  ) {
    return this.webhooksService.deleteWebhook(webhookId, partnerId);
  }
}