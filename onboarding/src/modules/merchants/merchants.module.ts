import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { BankAccountsService } from './bank-accounts.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { MerchantStateService } from './merchant-state.service';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { OwnersService } from './owners.service';

@Module({
  imports: [ComplianceModule, AuthModule],
  controllers: [MerchantsController, DocumentsController],
  providers: [
    MerchantsService,
    MerchantStateService,
    OwnersService,
    BankAccountsService,
    DocumentsService,
  ],
  exports: [MerchantStateService, MerchantsService],
})
export class MerchantsModule {}
