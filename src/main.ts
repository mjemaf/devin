import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { RlsMiddleware } from './common/middleware/rls.middleware';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';
import { VersionMiddleware } from './common/middleware/version.middleware';
import { ETagMiddleware } from './common/middleware/etag.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaService } from './database/prisma.service';
import { IdempotencyService } from './common/services/idempotency.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Apply request ID middleware (first, for tracing)
  const requestIdMiddleware = new RequestIdMiddleware();
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));

  // Apply RLS middleware (Layer 3 of tenancy isolation) - disabled for demo
  // const prismaService = app.get(PrismaService);
  // const rlsMiddleware = new RlsMiddleware(prismaService);
  // app.use(rlsMiddleware.use.bind(rlsMiddleware));

  // Apply version middleware (API version validation)
  const versionMiddleware = new VersionMiddleware();
  app.use(versionMiddleware.use.bind(versionMiddleware));

  // Apply ETag middleware (concurrency control) - disabled for demo
  // const etagMiddleware = new ETagMiddleware();
  // app.use(etagMiddleware.use.bind(etagMiddleware));

  // Apply idempotency middleware (disabled for demo - requires Redis)
  // const idempotencyService = app.get(IdempotencyService);
  // const idempotencyMiddleware = new IdempotencyMiddleware(idempotencyService);
  // app.use(idempotencyMiddleware.use.bind(idempotencyMiddleware));

  // CORS configuration
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Swagger API documentation
  const config = new DocumentBuilder()
    .setTitle('Fintech Onboarding API')
    .setDescription('Unified merchant onboarding API platform with advanced tenancy isolation')
    .setVersion('1.0')
    .addTag('merchants', 'Merchant onboarding and management')
    .addTag('verification', 'KYB/KYC verification services')
    .addTag('risk', 'Risk assessment and fraud detection')
    .addTag('underwriting', 'Automated underwriting decisions')
    .addTag('webhooks', 'Webhook management')
    .addTag('auth', 'Authentication and authorization')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap();