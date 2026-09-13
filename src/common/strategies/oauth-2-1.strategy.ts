import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtValidationService } from '../services/jwt-validation.service';
import { TokenRevocationService } from '../services/token-revocation.service';

/**
 * OAuth 2.1 JWT Strategy
 * 
 * Validates OAuth 2.1 JWT tokens with sender-constrained binding
 * Supports ES256 signatures and JWKS key rotation
 */
@Injectable()
export class OAuth21Strategy extends PassportStrategy(Strategy, 'oauth-2-1') {
  constructor(
    private jwtValidationService: JwtValidationService,
    private tokenRevocationService: TokenRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: async (request, rawJwtToken, done) => {
        try {
          // We don't need secret here since we use JWKS
          done(null, rawJwtToken);
        } catch (error) {
          done(error, null);
        }
      },
    });
  }

  async validate(token: string): Promise<any> {
    try {
      // Validate the token structure and signature
      const decoded = await this.jwtValidationService.validateToken(token);

      // Check if token is revoked
      if (decoded.jti && await this.tokenRevocationService.isRevoked(decoded.jti)) {
        throw new UnauthorizedException('Token has been revoked');
      }

      // Validate sender constraint (mTLS/DPoP)
      const certificateFingerprint = this.extractCertificateFingerprint();
      const dpopProof = this.extractDPoPProof();
      
      if (!this.jwtValidationService.validateSenderConstraint(decoded, certificateFingerprint, dpopProof)) {
        throw new UnauthorizedException('Token sender constraint validation failed');
      }

      // Validate required claims
      if (!decoded.org || !decoded.org_path) {
        throw new UnauthorizedException('Token missing required organization claims');
      }

      // Return user object with token claims
      return {
        sub: decoded.sub,
        org: decoded.org,
        org_path: decoded.org_path,
        scope: decoded.scope || [],
        residency: decoded.residency,
        jti: decoded.jti,
        exp: decoded.exp,
        iat: decoded.iat,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractCertificateFingerprint(): string | undefined {
    // Extract mTLS certificate fingerprint from request
    // This would be implemented based on your reverse proxy configuration
    return undefined;
  }

  private extractDPoPProof(): string | undefined {
    // Extract DPoP proof from header
    // This would be implemented according to RFC 9449
    return undefined;
  }
}