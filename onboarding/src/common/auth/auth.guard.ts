import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ApiException } from '../errors/api.exception';
import { ApiKeyService } from './api-key.service';
import { READ_ONLY_METHODS, Principal, SCOPES, Scope } from './principal';
import { PUBLIC_METADATA, SCOPES_METADATA } from './scopes.decorator';
import { SessionTokenService } from './session-token.service';

const ADMIN_PRINCIPAL_PARTNER = 'platform';

/**
 * Single entry point for the three supported credential types: partner API keys,
 * onboarding session JWTs, and the platform bootstrap admin key.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyService,
    private readonly sessions: SessionTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const principal = await this.authenticate(request);
    request.principal = principal;

    const required =
      this.reflector.getAllAndOverride<Scope[]>(SCOPES_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    this.authorize(principal, required, request.method);
    return true;
  }

  private async authenticate(request: Request): Promise<Principal> {
    const credential = this.extractCredential(request);
    if (!credential) {
      throw ApiException.unauthenticated(
        'missing_credentials',
        'Provide an API key via the Authorization header or X-Api-Key.',
      );
    }

    if (credential.kind === 'bearer_jwt') {
      return this.sessions.verify(credential.value);
    }

    if (this.apiKeys.isAdminKey(credential.value)) {
      return {
        partnerId: ADMIN_PRINCIPAL_PARTNER,
        actorId: 'platform_admin',
        actorType: 'user',
        role: 'admin',
        scopes: [...SCOPES],
        livemode: false,
      };
    }

    const principal = await this.apiKeys.resolve(credential.value);
    if (!principal) {
      throw ApiException.unauthenticated('invalid_api_key', 'The supplied API key is not valid.');
    }
    return principal;
  }

  private extractCredential(
    request: Request,
  ): { kind: 'api_key' | 'bearer_jwt'; value: string } | null {
    const headerKey = request.header('x-api-key');
    if (headerKey) {
      return { kind: 'api_key', value: headerKey };
    }

    const authorization = request.header('authorization');
    if (!authorization) {
      return null;
    }

    const [scheme, ...rest] = authorization.split(' ');
    const value = rest.join(' ').trim();
    if (!value) {
      return null;
    }
    if (scheme.toLowerCase() === 'api-key') {
      return { kind: 'api_key', value };
    }
    if (scheme.toLowerCase() === 'bearer') {
      return value.startsWith('sk_')
        ? { kind: 'api_key', value }
        : { kind: 'bearer_jwt', value };
    }
    return null;
  }

  private authorize(principal: Principal, required: Scope[], method: string): void {
    if (principal.role === 'viewer' && !READ_ONLY_METHODS.has(method)) {
      throw ApiException.forbidden(
        'insufficient_role',
        'Viewer credentials cannot perform write operations.',
      );
    }

    const missing = required.filter((scope) => !principal.scopes.includes(scope));
    if (missing.length > 0) {
      throw ApiException.forbidden(
        'insufficient_scope',
        `The credential is missing required scope(s): ${missing.join(', ')}.`,
      );
    }
  }
}
