import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ApiErrorBody, ApiException } from './api.exception';

interface NestValidationBody {
  message?: string | string[];
  error?: string;
}

/** Normalises every failure into the documented `{ error: { ... } }` envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const requestId = (request.headers['x-request-id'] as string) ?? 'req_unknown';

    const { status, error } = this.describe(exception);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ requestId, exception }, 'Unhandled exception');
    }

    response.status(status).json({ error: { ...error, request_id: requestId } });
  }

  private describe(exception: unknown): { status: number; error: ApiErrorBody } {
    if (exception instanceof ApiException) {
      return { status: exception.getStatus(), error: exception.error };
    }
    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        error: {
          type: 'rate_limit_error',
          code: 'too_many_requests',
          message: 'Rate limit exceeded for this API key',
        },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as string | NestValidationBody;
      const message =
        typeof body === 'string'
          ? body
          : Array.isArray(body.message)
            ? body.message[0]
            : (body.message ?? exception.message);
      return {
        status,
        error: {
          type: status === HttpStatus.BAD_REQUEST ? 'validation_error' : 'api_error',
          code:
            status === HttpStatus.BAD_REQUEST ? 'invalid_request_parameter' : 'unexpected_error',
          message,
        },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: {
        type: 'api_error',
        code: 'unexpected_error',
        message: 'An unexpected error occurred',
      },
    };
  }
}
