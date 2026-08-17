import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { OwnersController } from './owners.controller';
import { OwnersService } from './owners.service';

@Module({
  imports: [MerchantsModule],
  controllers: [OwnersController],
  providers: [OwnersService],
  exports: [OwnersService],
})
export class OwnersModule {}
