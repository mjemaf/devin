import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

@Module({
  controllers: [MerchantsController],
  providers: [MerchantsService, DocumentsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
