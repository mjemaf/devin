import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { newId } from '../ids';
import { ApiErrorBody } from './api.exception';

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
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // Body-parser failures short-circuit before RequestIdMiddleware, so mint an id here.
    const requestId = (request.headers['x-request-id'] as string | undefined) ?? newId('request');

    const { status, error } = this.normalise(exception);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ err: exception, requestId }, 'unhandled_error');
    }

    response.status(status).json({ error: { ...error, request_id: requestId } });
  }

  private normalise(exception: unknown): { status: number; error: ApiErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Our own exceptions carry the envelope; Nest's built-ins put a status phrase in `error`.
      const envelope = (body as { error?: unknown } | null)?.error;
      if (typeof body === 'object' && typeof envelope === 'object' && envelope !== null) {
        return { status, error: envelope as ApiErrorBody };
      }

      const validation = (typeof body === 'object' ? body : {}) as NestValidationBody;
      const messages = Array.isArray(validation.message) ? validation.message : undefined;
      return {
        status,
        error: {
          type: this.typeForStatus(status),
          code: this.codeForStatus(status),
          message: messages
            ? messages.join('; ')
            : typeof validation.message === 'string'
              ? validation.message
              : exception.message,
          param: messages ? this.paramFromMessage(messages[0]) : undefined,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: {
        type: 'api_error',
        code: 'internal_error',
        message: 'An unexpected error occurred while processing the request',
      },
    };
  }

  private typeForStatus(status: number): ApiErrorBody['type'] {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'validation_error';
      case HttpStatus.UNAUTHORIZED:
        return 'authentication_error';
      case HttpStatus.FORBIDDEN:
        return 'authorization_error';
      case HttpStatus.NOT_FOUND:
        return 'not_found_error';
      case HttpStatus.CONFLICT:
        return 'conflict_error';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'rate_limit_error';
      default:
        return 'api_error';
    }
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'invalid_request_parameter';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'rate_limit_exceeded';
      case HttpStatus.NOT_FOUND:
        return 'resource_not_found';
      default:
        return 'request_failed';
    }
  }

  /** class-validator messages start with the offending property name. */
  private paramFromMessage(message: string | undefined): string | undefined {
    return message?.split(' ')[0];
  }
}
