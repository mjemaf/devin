import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorBody, ApiErrorType } from './api.exception';

interface NestValidationPayload {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

const TYPE_BY_STATUS: Record<number, ApiErrorType> = {
  [HttpStatus.BAD_REQUEST]: 'validation_error',
  [HttpStatus.UNAUTHORIZED]: 'authentication_error',
  [HttpStatus.FORBIDDEN]: 'authorization_error',
  [HttpStatus.NOT_FOUND]: 'not_found_error',
  [HttpStatus.CONFLICT]: 'conflict_error',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'validation_error',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limit_error',
};

/** Distinguishes our own envelope from Nest payloads that also carry an `error` string. */
function isApiErrorPayload(payload: unknown): payload is { error: ApiErrorBody } {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
    return false;
  }
  const error = (payload as { error: unknown }).error;
  return typeof error === 'object' && error !== null && 'type' in error && 'code' in error;
}

/**
 * Normalises everything thrown inside the app into the documented error envelope,
 * so partners never have to branch on framework-specific shapes.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as Request & { requestId?: string }).requestId;

    const { status, body } = this.normalise(exception);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ err: exception, requestId }, 'unhandled_error');
    }

    response.status(status).json({ error: { ...body, request_id: requestId } });
  }

  private normalise(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (isApiErrorPayload(payload)) {
        return { status, body: payload.error };
      }

      const nest = (typeof payload === 'object' ? payload : {}) as NestValidationPayload;
      const messages = Array.isArray(nest.message) ? nest.message : [nest.message];
      return {
        status,
        body: {
          type: TYPE_BY_STATUS[status] ?? 'api_error',
          code: status === HttpStatus.BAD_REQUEST ? 'invalid_request_parameter' : 'request_failed',
          message: messages.filter(Boolean).join('; ') || exception.message,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        type: 'api_error',
        code: 'internal_error',
        message: 'An unexpected error occurred while processing the request.',
      },
    };
  }
}
