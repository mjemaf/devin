import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../common/errors/api.exception';
import { AuthenticatedRequest, Scope } from './auth-context';
import { PUBLIC_ROUTE, REQUIRED_SCOPES } from './decorators';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = {
      ...(await this.resolveAuth(request)),
      requestId: request.requestId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };

    const required = this.reflector.getAllAndOverride<Scope[]>(REQUIRED_SCOPES, [
      context.getHandler(),
      context.getClass(),
    ]);
    const missing = (required ?? []).filter((scope) => !request.auth?.scopes.includes(scope));
    if (missing.length > 0) {
      throw ApiException.forbidden(
        'insufficient_scope',
        `This credential is missing the required scope(s): ${missing.join(', ')}`,
      );
    }

    return true;
  }

  private async resolveAuth(request: AuthenticatedRequest) {
    const apiKeyHeader = request.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
      return this.authService.authenticateApiKey(apiKeyHeader);
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw ApiException.unauthenticated(
        'Provide credentials via the `Authorization: Bearer` header or the `X-API-Key` header',
      );
    }

    const credential = authorization.slice('Bearer '.length).trim();
    return credential.startsWith('sk_')
      ? this.authService.authenticateApiKey(credential)
      : this.authService.authenticateBearerToken(credential);
  }
}
