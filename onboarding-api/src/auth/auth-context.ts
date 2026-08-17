import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ApiException } from '../common/errors/api.exception';

export type Scope = 'read' | 'write' | 'admin';
export type Role = 'admin' | 'operator' | 'viewer';

export const SCOPES_BY_ROLE: Record<Role, Scope[]> = {
  admin: ['read', 'write', 'admin'],
  operator: ['read', 'write'],
  viewer: ['read'],
};

export interface AuthContext {
  partnerId: string;
  actorId: string;
  actorType: 'partner' | 'user';
  role: Role;
  scopes: Scope[];
  credential: 'api_key' | 'jwt';
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  requestId?: string;
}

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) {
    throw ApiException.unauthenticated('Request is not authenticated');
  }
  return request.auth;
});
