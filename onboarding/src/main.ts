import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { buildValidationPipe } from './common/validation.pipe';

export const API_PREFIX = 'v1';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  const config = app.get(ConfigService);

  app.use(helmet());
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(buildValidationPipe());

  const swagger = new DocumentBuilder()
    .setTitle('Unified Merchant Onboarding API')
    .setDescription(
      'Onboarding, verification, risk, and underwriting for global SMB merchants. ' +
        'Authenticate with a partner API key (`Authorization: Bearer sk_...`) or a ' +
        'merchant-scoped onboarding token.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer' })
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(config.get<number>('port', 3000));
}

void bootstrap();
