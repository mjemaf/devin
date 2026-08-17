import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../errors/api.exception';
import { ApiKeyService } from './api-key.service';
import { AuthenticatedRequest } from './auth-context.decorator';
import { OnboardingTokenService } from './onboarding-token.service';
import { PUBLIC_METADATA_KEY } from './public.decorator';
import { SCOPES_METADATA_KEY } from './scopes.decorator';
import { Scope } from './auth.types';

/**
 * Accepts either a partner API key (`Authorization: Bearer sk_...` or `X-Api-Key`)
 * or a merchant-scoped onboarding token, then enforces the endpoint's scopes.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyService,
    private readonly onboardingTokens: OnboardingTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const credential = this.extractCredential(request);
    if (!credential) {
      throw ApiException.unauthenticated('Missing API key', 'missing_api_key');
    }

    const auth = credential.startsWith('sk_')
      ? await this.apiKeys.authenticate(credential)
      : await this.onboardingTokens.verify(credential);
    if (!auth) {
      throw ApiException.unauthenticated('Invalid or revoked credential');
    }
    request.auth = auth;

    const required =
      this.reflector.getAllAndOverride<Scope[]>(SCOPES_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const missing = required.filter((scope) => !auth.scopes.includes(scope));
    if (missing.length > 0) {
      throw ApiException.forbidden(`Credential is missing required scope: ${missing.join(', ')}`);
    }
    return true;
  }

  private extractCredential(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim();
    }
    const apiKeyHeader = request.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
      return apiKeyHeader;
    }
    return null;
  }
}
