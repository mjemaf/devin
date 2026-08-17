import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiException } from './common/errors/api.exception';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  const config = app.get(ConfigService);

  app.use(helmet());
  app.enableCors({ origin: true, credentials: true });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Surface the first failure per field in the documented error envelope.
      exceptionFactory: (errors) =>
        ApiException.validation(
          'invalid_request_parameter',
          errors
            .map((error) => Object.values(error.constraints ?? {}).join(', '))
            .filter(Boolean)
            .join('; ') || 'The request payload is invalid.',
          errors[0]?.property,
        ),
    }),
  );

  setupSwagger(app);

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Onboarding API listening on port ${port} (docs at /docs)`);
}

void bootstrap();
