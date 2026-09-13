import { Module } from '@nestjs/common';
import { UnderwritingService } from './underwriting.service';
import { UnderwritingController } from './underwriting.controller';

@Module({
  controllers: [UnderwritingController],
  providers: [UnderwritingService],
  exports: [UnderwritingService],
})
export class UnderwritingModule {}