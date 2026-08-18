import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export interface RequestContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export function requestContextOf(request: Request): RequestContext {
  return {
    requestId: (request as Request & { requestId?: string }).requestId,
    ipAddress: request.ip,
    userAgent: request.header('user-agent'),
  };
}

export const ReqContext = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  requestContextOf(ctx.switchToHttp().getRequest<Request>()),
);
