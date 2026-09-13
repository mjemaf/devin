import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';
import { VerificationCascadeService } from './verification-cascade.service';
import { CircuitBreakerRegistry } from './circuit-breaker/circuit-breaker.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    VerificationCascadeService,
    CircuitBreakerRegistry,
  ],
  exports: [
    VerificationService,
    VerificationCascadeService,
    CircuitBreakerRegistry,
  ],
})
export class VerificationModule {}
