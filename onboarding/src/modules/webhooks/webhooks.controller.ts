import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../common/auth/current-principal.decorator';
import { Principal } from '../../common/auth/principal';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ReqContext, RequestContext } from '../../common/context/request-context';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  @Post()
  @RequireScopes('webhooks:write')
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateWebhookDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.webhooks.create(principal, dto, context);
  }

  @Get()
  @RequireScopes('webhooks:read')
  @ApiOperation({ summary: 'List webhook endpoints' })
  list(@CurrentPrincipal() principal: Principal) {
    return this.webhooks.list(principal);
  }

  @Patch(':reference')
  @RequireScopes('webhooks:write')
  @ApiOperation({ summary: 'Update a webhook endpoint' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: UpdateWebhookDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.webhooks.update(principal, reference, dto, context);
  }

  @Delete(':reference')
  @RequireScopes('webhooks:write')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.webhooks.remove(principal, reference, context);
  }

  @Get(':reference/deliveries')
  @RequireScopes('webhooks:read')
  @ApiOperation({
    summary: 'Inspect recent deliveries',
    description: 'Delivery log with attempt counts and payloads, for webhook debugging and replay.',
  })
  deliveries(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Query('limit') limit = '25',
  ) {
    return this.webhooks.deliveries(principal, reference, Math.min(Number(limit) || 25, 100));
  }

  @Post('deliveries/:deliveryId/retry')
  @RequireScopes('webhooks:write')
  @ApiOperation({ summary: 'Retry a delivery immediately' })
  async retry(@Param('deliveryId') deliveryId: string) {
    await this.dispatcher.attempt(deliveryId);
    return { delivery_id: deliveryId, retried: true };
  }
}
