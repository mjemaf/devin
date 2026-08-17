import { Module } from '@nestjs/common';
import { BankAccountsModule } from '../bank-accounts/bank-accounts.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SandboxVerificationProvider } from './providers/sandbox.provider';
import { VERIFICATION_PROVIDER } from './providers/verification-provider';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [MerchantsModule, BankAccountsModule, WebhooksModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    { provide: VERIFICATION_PROVIDER, useClass: SandboxVerificationProvider },
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
