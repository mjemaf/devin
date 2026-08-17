import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { MerchantsModule } from '../merchants/merchants.module';
import {
  MockBankProvider,
  MockBusinessProvider,
  MockIdentityProvider,
} from './providers/mock-providers';
import {
  BANK_PROVIDER,
  BUSINESS_PROVIDER,
  IDENTITY_PROVIDER,
} from './providers/provider.types';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

/**
 * Providers are bound behind symbols so a live vendor implementation can replace the
 * sandbox one per deployment without touching the service layer.
 */
@Module({
  imports: [MerchantsModule, ComplianceModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    { provide: BUSINESS_PROVIDER, useClass: MockBusinessProvider },
    { provide: IDENTITY_PROVIDER, useClass: MockIdentityProvider },
    { provide: BANK_PROVIDER, useClass: MockBankProvider },
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
