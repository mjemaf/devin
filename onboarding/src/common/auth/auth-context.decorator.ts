import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { ApiException } from '../errors/api.exception';
import { AuthContext } from './auth.types';

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw ApiException.unauthenticated('Request is not authenticated');
    }
    return request.auth;
  },
);
