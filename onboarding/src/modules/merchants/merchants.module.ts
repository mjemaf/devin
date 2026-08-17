import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { OnboardingStepsService } from './onboarding-steps.service';

@Module({
  imports: [AuthModule, WebhooksModule],
  controllers: [MerchantsController],
  providers: [MerchantsService, OnboardingStepsService],
  exports: [MerchantsService, OnboardingStepsService],
})
export class MerchantsModule {}
