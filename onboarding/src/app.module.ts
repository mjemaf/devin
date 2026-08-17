import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './common/audit/audit.module';
import { AuthGuard } from './common/auth/auth.guard';
import { AuthModule } from './common/auth/auth.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { PrismaModule } from './common/prisma/prisma.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { StorageModule } from './common/storage/storage.module';
import configuration from './config/configuration';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { HealthModule } from './modules/health/health.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { OwnersModule } from './modules/owners/owners.module';
import { RiskModule } from './modules/risk/risk.module';
import { UnderwritingModule } from './modules/underwriting/underwriting.module';
import { VerificationModule } from './modules/verification/verification.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ ttl: 60_000, limit: config.get<number>('rateLimitPerMinute', 1000) }],
      }),
    }),
    PrismaModule,
    AuditModule,
    StorageModule,
    AuthModule,
    HealthModule,
    MerchantsModule,
    OwnersModule,
    BankAccountsModule,
    DocumentsModule,
    VerificationModule,
    RiskModule,
    UnderwritingModule,
    WebhooksModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
