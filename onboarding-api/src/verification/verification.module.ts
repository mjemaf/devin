import { Global, Module } from '@nestjs/common';
import { MerchantStateService } from '../merchants/merchant-state.service';
import {
  SandboxBankVerificationProvider,
  SandboxBusinessVerificationProvider,
  SandboxIdentityVerificationProvider,
} from './providers/sandbox.providers';
import {
  BANK_VERIFICATION_PROVIDER,
  BUSINESS_VERIFICATION_PROVIDER,
  IDENTITY_VERIFICATION_PROVIDER,
} from './providers/verification-provider';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Global()
@Module({
  controllers: [VerificationController],
  providers: [
    VerificationService,
    MerchantStateService,
    { provide: BUSINESS_VERIFICATION_PROVIDER, useClass: SandboxBusinessVerificationProvider },
    { provide: IDENTITY_VERIFICATION_PROVIDER, useClass: SandboxIdentityVerificationProvider },
    { provide: BANK_VERIFICATION_PROVIDER, useClass: SandboxBankVerificationProvider },
  ],
  exports: [VerificationService, MerchantStateService],
})
export class VerificationModule {}
