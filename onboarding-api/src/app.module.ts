import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ComplianceModule } from './compliance/compliance.module';
import { configuration } from './config/configuration';
import { HealthController } from './health/health.controller';
import { MerchantsModule } from './merchants/merchants.module';
import { PrismaModule } from './prisma/prisma.module';
import { RiskModule } from './risk/risk.module';
import { UnderwritingModule } from './underwriting/underwriting.module';
import { VerificationModule } from './verification/verification.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    LoggerModule.forRoot({
      pinoHttp: {
        // Credentials and idempotency keys must never reach the log sink.
        redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.body.tax_id'],
        customProps: (req) => ({ requestId: req.headers['x-request-id'] }),
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        { ttl: 60_000, limit: config.get<number>('rateLimitPerMinute') ?? 1000 },
      ],
    }),
    PrismaModule,
    AuditModule,
    ComplianceModule,
    AuthModule,
    WebhooksModule,
    VerificationModule,
    RiskModule,
    UnderwritingModule,
    MerchantsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
