import { HttpException, HttpStatus } from '@nestjs/common';

export type ApiErrorType =
  | 'validation_error'
  | 'authentication_error'
  | 'authorization_error'
  | 'not_found_error'
  | 'conflict_error'
  | 'rate_limit_error'
  | 'api_error';

export interface ApiErrorBody {
  type: ApiErrorType;
  code: string;
  message: string;
  param?: string;
}

/**
 * Carries the flat error shape documented in the API reference. The request id is
 * attached by the exception filter, which is the only place that knows about it.
 */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, readonly body: ApiErrorBody) {
    super({ error: body }, status);
  }

  static validation(code: string, message: string, param?: string): ApiException {
    return new ApiException(HttpStatus.BAD_REQUEST, {
      type: 'validation_error',
      code,
      message,
      param,
    });
  }

  static unauthenticated(code: string, message: string): ApiException {
    return new ApiException(HttpStatus.UNAUTHORIZED, {
      type: 'authentication_error',
      code,
      message,
    });
  }

  static forbidden(code: string, message: string): ApiException {
    return new ApiException(HttpStatus.FORBIDDEN, {
      type: 'authorization_error',
      code,
      message,
    });
  }

  static notFound(code: string, message: string): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, { type: 'not_found_error', code, message });
  }

  static conflict(code: string, message: string): ApiException {
    return new ApiException(HttpStatus.CONFLICT, { type: 'conflict_error', code, message });
  }

  static unprocessable(code: string, message: string, param?: string): ApiException {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, {
      type: 'validation_error',
      code,
      message,
      param,
    });
  }
}
