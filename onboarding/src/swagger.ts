import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Publishes the OpenAPI document at /docs/openapi.json and Swagger UI at /docs. */
export function setupSwagger(app: INestApplication): void {
  const swagger = new DocumentBuilder()
    .setTitle('Unified Merchant Onboarding API')
    .setDescription(
      'Merchant onboarding for global SMB and micro-merchants: KYB/KYC verification, ' +
        'bank validation, risk scoring, automated underwriting and webhooks.',
    )
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'ApiKey')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'OnboardingSession')
    // Applied to every operation so "Try it out" sends whatever Authorize collected.
    .addSecurityRequirements('ApiKey')
    .addSecurityRequirements('OnboardingSession')
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger), {
    jsonDocumentUrl: 'docs/openapi.json',
  });
}
