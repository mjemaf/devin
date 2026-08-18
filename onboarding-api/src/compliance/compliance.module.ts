import { Global, Module } from '@nestjs/common';
import { ComplianceService } from './compliance.service';

@Global()
@Module({
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
