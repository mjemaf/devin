import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { VerificationModule } from './modules/verification/verification.module';
import { RiskModule } from './modules/risk/risk.module';
import { UnderwritingModule } from './modules/underwriting/underwriting.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AuthModule } from './modules/auth/auth.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { IdempotencyService } from './common/services/idempotency.service';
import { TenancyGuard } from './common/guards/tenancy.guard';
import { IdempotencyGuard } from './common/guards/idempotency.guard';
import { ProblemJsonFilter } from './common/filters/problem-json.filter';
import { CrossTenantProtectionInterceptor } from './common/interceptors/cross-tenant-protection.interceptor';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 1000, // 1000 requests per minute
      },
    ]),
    DatabaseModule,
    MerchantsModule,
    VerificationModule,
    RiskModule,
    UnderwritingModule,
    WebhooksModule,
    AuthModule,
    OnboardingModule,
    WorkflowModule,
  ],
  providers: [
    // {
    //   provide: APP_GUARD,
    //   useClass: TenancyGuard,
    // },
    // {
    //   provide: APP_GUARD,
    //   useClass: IdempotencyGuard,
    // },
    {
      provide: APP_FILTER,
      useClass: ProblemJsonFilter,
    },
    // {
    //   provide: APP_INTERCEPTOR,
    //   useClass: CrossTenantProtectionInterceptor,
    // },
    IdempotencyService,
  ],
})
export class AppModule {}