import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScopeValidationService } from '../services/scope-validation.service';
import { ApiKeyService } from '../services/api-key.service';
import { JwtValidationService } from '../services/jwt-validation.service';
import { TokenRevocationService } from '../services/token-revocation.service';

/**
 * Enhanced Authentication Guard
 * 
 * Supports both OAuth 2.1 JWT tokens and API keys
 * Enforces scope-based authorization
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private scopeValidationService: ScopeValidationService,
    private apiKeyService: ApiKeyService,
    private jwtValidationService: JwtValidationService,
    private tokenRevocationService: TokenRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers['authorization'];
    const apiKey = request.headers['x-api-key'] as string;

    try {
      if (authorization) {
        // Try OAuth 2.1 JWT authentication
        await this.authenticateWithJWT(request, authorization);
      } else if (apiKey) {
        // Try API key authentication
        await this.authenticateWithApiKey(request, apiKey);
      } else {
        throw new UnauthorizedException('Authentication required');
      }

      await this.validateScopes(context);
      return true;
    } catch (error) {
      throw new UnauthorizedException('Authentication failed');
    }
  }

  private async authenticateWithJWT(request: any, authorization: string): Promise<void> {
    // Extract Bearer token
    const token = authorization.replace('Bearer ', '');
    
    // Validate JWT token
    const decoded = await this.jwtValidationService.validateToken(token);

    // Check if token is revoked
    if (decoded.jti && await this.tokenRevocationService.isRevoked(decoded.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Validate sender constraint (mTLS/DPoP)
    const certificateFingerprint = this.extractCertificateFingerprint(request);
    const dpopProof = this.extractDPoPProof(request);
    
    if (!this.jwtValidationService.validateSenderConstraint(decoded, certificateFingerprint, dpopProof)) {
      throw new UnauthorizedException('Token sender constraint validation failed');
    }

    // Set user from JWT
    request.user = {
      sub: decoded.sub,
      org: decoded.org,
      org_path: decoded.org_path,
      scope: decoded.scope || [],
      residency: decoded.residency,
      jti: decoded.jti,
      exp: decoded.exp,
      iat: decoded.iat,
    };
  }

  private async authenticateWithApiKey(request: any, apiKey: string): Promise<void> {
    // Validate API key format
    if (!apiKey.startsWith('sk_live_') && !apiKey.startsWith('sk_test_')) {
      throw new UnauthorizedException('Invalid API key format');
    }

    // Validate API key against database
    const user = await this.apiKeyService.validateApiKey(apiKey);

    // Validate CIDR allowlist
    const clientIp = request.ip;
    if (!this.apiKeyService.validateCIDR(clientIp, user.cidrAllowlist)) {
      throw new UnauthorizedException('IP address not in allowlist');
    }

    request.user = user;
  }

  private async validateScopes(context: ExecutionContext): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const requiredScopes = this.reflector.get<string[]>('scopes', context.getHandler());

    if (!requiredScopes || requiredScopes.length === 0) {
      return; // No scope requirements
    }

    const tokenScopes = user.scope || [];

    if (!this.scopeValidationService.hasAllScopes(tokenScopes, requiredScopes)) {
      throw new ForbiddenException('Insufficient scope for this operation');
    }
  }

  private extractCertificateFingerprint(request: any): string | undefined {
    // Extract mTLS certificate fingerprint from request
    // This would be implemented based on your reverse proxy configuration
    return undefined;
  }

  private extractDPoPProof(request: any): string | undefined {
    // Extract DPoP proof from header
    // This would be implemented according to RFC 9449
    return undefined;
  }
}

/**
 * Scopes decorator
 * 
 * Marks a controller or method with required scopes
 */
export const Scopes = (...scopes: string[]) => {
  return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata('scopes', scopes, descriptor?.value || target);
  };
};