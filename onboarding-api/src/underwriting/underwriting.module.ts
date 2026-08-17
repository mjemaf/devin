import { Module } from '@nestjs/common';
import { UnderwritingController } from './underwriting.controller';
import { UnderwritingService } from './underwriting.service';

@Module({
  controllers: [UnderwritingController],
  providers: [UnderwritingService],
  exports: [UnderwritingService],
})
export class UnderwritingModule {}
