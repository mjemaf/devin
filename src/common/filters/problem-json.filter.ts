import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ValidationError } from 'class-validator';

/**
 * RFC 9457 Problem Details Exception Filter
 * 
 * Converts all errors to RFC 9457 problem+json format
 * with stable code field for programmatic handling
 */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const problemDetails = this.buildProblemDetails(exception, request, status);

    response.status(status).json(problemDetails);
  }

  private buildProblemDetails(
    exception: unknown,
    request: Request,
    status: number
  ): any {
    // Generate stable error code
    const code = this.generateErrorCode(exception, status);

    // Handle validation errors from class-validator
    if (this.isValidationError(exception)) {
      return {
        type: 'https://docs.example.com/errors/validation-failed',
        title: 'Validation failed',
        status: 422,
        code: 'validation_failed',
        detail: `${exception.length} fields failed validation.`,
        instance: request.url,
        request_id: this.generateRequestId(),
        retryable: false,
        errors: this.buildValidationErrors(exception),
      };
    }

    // Handle HTTP exceptions
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message = this.extractMessage(response);

      return {
        type: `https://docs.example.com/errors/${code}`,
        title: this.getTitle(status),
        status,
        code,
        detail: message,
        instance: request.url,
        request_id: this.generateRequestId(),
        retryable: this.isRetryable(status, code),
      };
    }

    // Handle unknown errors
    return {
      type: 'https://docs.example.com/errors/internal-server-error',
      title: 'Internal server error',
      status: 500,
      code: 'internal_server_error',
      detail: 'An unexpected error occurred',
      instance: request.url,
      request_id: this.generateRequestId(),
      retryable: true,
    };
  }

  private generateErrorCode(exception: unknown, status: number): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'object' && 'code' in response) {
        return response.code as string;
      }
    }

    // Generate stable code based on status
    const statusCodes: Record<number, string> = {
      400: 'bad_request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not_found',
      409: 'conflict',
      412: 'precondition_failed',
      422: 'validation_failed',
      428: 'precondition_required',
      429: 'rate_limited',
      500: 'internal_server_error',
    };

    return statusCodes[status] || 'unknown_error';
  }

  private isValidationError(exception: unknown): exception is ValidationError[] {
    return (
      Array.isArray(exception) &&
      exception.length > 0 &&
      exception[0] instanceof ValidationError
    );
  }

  private buildValidationErrors(errors: ValidationError[]): any[] {
    return errors.map((error) => ({
      pointer: this.buildJsonPointer(error.property),
      code: this.getValidationErrorCode(error),
      message: Object.values(error.constraints || {}).join(', '),
      constraint: error.constraints,
    }));
  }

  private buildJsonPointer(property: string): string {
    return `/${property.replace(/\./g, '/')}`;
  }

  private getValidationErrorCode(error: ValidationError): string {
    const constraints = error.constraints || {};
    const keys = Object.keys(constraints);
    
    if (keys.length === 0) return 'validation_error';
    
    // Map common validation constraints to stable codes
    const constraintMap: Record<string, string> = {
      isEmail: 'invalid_email',
      isUrl: 'invalid_url',
      isNotEmpty: 'empty_value',
      minLength: 'too_short',
      maxLength: 'too_long',
      min: 'too_small',
      max: 'too_large',
      isEnum: 'invalid_enum',
      matches: 'pattern_mismatch',
    };

    const firstConstraint = keys[0];
    return constraintMap[firstConstraint] || 'validation_error';
  }

  private extractMessage(response: string | object): string {
    if (typeof response === 'string') {
      return response;
    }

    if (typeof response === 'object' && 'message' in response) {
      const message = response.message;
      if (Array.isArray(message)) {
        return message.join(', ');
      }
      return message as string;
    }

    return 'An error occurred';
  }

  private getTitle(status: number): string {
    const titles: Record<number, string> = {
      400: 'Bad request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not found',
      409: 'Conflict',
      412: 'Precondition failed',
      422: 'Validation failed',
      428: 'Precondition required',
      429: 'Rate limited',
      500: 'Internal server error',
    };

    return titles[status] || 'Error';
  }

  private isRetryable(status: number, code: string): boolean {
    // 4xx errors are generally not retryable except 429
    if (status >= 400 && status < 500) {
      return status === 429 || code === 'idempotency_request_in_progress';
    }

    // 5xx errors are retryable
    return status >= 500;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}