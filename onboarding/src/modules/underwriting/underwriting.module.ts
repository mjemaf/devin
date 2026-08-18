import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { RiskModule } from '../risk/risk.module';
import { UnderwritingController } from './underwriting.controller';
import { UnderwritingService } from './underwriting.service';

@Module({
  imports: [MerchantsModule, RiskModule],
  controllers: [UnderwritingController],
  providers: [UnderwritingService],
})
export class UnderwritingModule {}
