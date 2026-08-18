import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { ApiException } from './common/errors/api.exception';

/** Shared wiring so the e2e suite exercises the same pipeline as production. */
export function configureApp(app: INestApplication): INestApplication {
  // Base64 document uploads inflate by ~4/3, so the parser sits above the 10 MB file cap.
  app.use(json({ limit: '16mb' }));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const first = errors[0];
        const message = Object.values(first?.constraints ?? {})[0] ?? 'Request validation failed';
        return ApiException.validation('invalid_request_parameter', message, first?.property);
      },
    }),
  );
  return app;
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Merchant Onboarding API')
    .setDescription(
      'Unified onboarding, verification, risk and underwriting API for global SMB and micro-merchants.',
    )
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'apiKey')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();
  SwaggerModule.setup('v1/docs', app, SwaggerModule.createDocument(app, config));
}
