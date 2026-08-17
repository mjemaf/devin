import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

@Module({
  imports: [AuthModule],
  controllers: [PartnersController],
  providers: [PartnersService],
})
export class PartnersModule {}
