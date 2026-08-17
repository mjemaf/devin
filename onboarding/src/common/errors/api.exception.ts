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

const STATUS_BY_TYPE: Record<ApiErrorType, HttpStatus> = {
  validation_error: HttpStatus.BAD_REQUEST,
  authentication_error: HttpStatus.UNAUTHORIZED,
  authorization_error: HttpStatus.FORBIDDEN,
  not_found_error: HttpStatus.NOT_FOUND,
  conflict_error: HttpStatus.CONFLICT,
  rate_limit_error: HttpStatus.TOO_MANY_REQUESTS,
  api_error: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Carries the platform's documented error envelope (see docs/api-reference.md). */
export class ApiException extends HttpException {
  readonly error: ApiErrorBody;

  constructor(error: ApiErrorBody) {
    super({ error }, STATUS_BY_TYPE[error.type]);
    this.error = error;
  }

  static validation(message: string, code = 'invalid_request_parameter', param?: string) {
    return new ApiException({ type: 'validation_error', code, message, param });
  }

  static notFound(resource: string, id: string) {
    return new ApiException({
      type: 'not_found_error',
      code: 'resource_not_found',
      message: `No such ${resource}: ${id}`,
    });
  }

  static conflict(message: string, code = 'resource_conflict') {
    return new ApiException({ type: 'conflict_error', code, message });
  }

  static unauthenticated(message: string, code = 'invalid_api_key') {
    return new ApiException({ type: 'authentication_error', code, message });
  }

  static forbidden(message: string, code = 'insufficient_scope') {
    return new ApiException({ type: 'authorization_error', code, message });
  }
}
