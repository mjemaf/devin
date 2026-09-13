import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = exception instanceof HttpException ? exception.message : 'Internal server error';

    const errorResponse = {
      error: {
        type: this.getErrorType(status),
        code: this.getErrorCode(exception),
        message,
        param: this.getErrorParam(exception),
        request_id: this.generateRequestId(),
      },
    };

    response.status(status).json(errorResponse);
  }

  private getErrorType(status: number): string {
    if (status === 400) return 'validation_error';
    if (status === 401) return 'authentication_error';
    if (status === 429) return 'rate_limit_error';
    return 'api_error';
  }

  private getErrorCode(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return 'api_error';
    if (typeof response === 'object' && 'message' in response) {
      if (Array.isArray(response.message)) {
        return 'invalid_request_parameter';
      }
    }
    return 'api_error';
  }

  private getErrorParam(exception: HttpException): string | undefined {
    const response = exception.getResponse();
    if (typeof response === 'object' && 'message' in response) {
      if (Array.isArray(response.message)) {
        return response.message[0];
      }
    }
    return undefined;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}