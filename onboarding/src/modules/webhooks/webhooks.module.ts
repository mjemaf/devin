import { Global, Module } from '@nestjs/common';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Global()
@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcherService],
  exports: [WebhookDispatcherService],
})
export class WebhooksModule {}
