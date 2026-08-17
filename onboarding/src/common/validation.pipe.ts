import { ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from './errors/validation.exception-factory';

/** Single source of validation behaviour for the app and the e2e harness. */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });
}
