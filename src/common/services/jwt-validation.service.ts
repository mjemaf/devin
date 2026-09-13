import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
const jwksClient = require('jwks-rsa');

/**
 * JWT Validation Service
 * 
 * Validates OAuth 2.1 JWT tokens with ES256 signatures
 * Supports JWKS endpoint with key rotation
 */
@Injectable()
export class JwtValidationService {
  private jwksClient: any;

  constructor() {
    // Initialize JWKS client for key rotation
    this.jwksClient = jwksClient({
      jwksUri: process.env.JWKS_URI || 'https://auth.example.com/.well-known/jwks.json',
      cache: true,
      cacheMaxAge: 600000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }

  /**
   * Validate JWT token
   */
  async validateToken(token: string): Promise<any> {
    try {
      const decoded = await new Promise((resolve, reject) => {
        jwt.verify(token, this.getKey.bind(this), {
          algorithms: ['ES256'],
          audience: process.env.JWT_AUDIENCE || 'https://api.example.com',
          issuer: process.env.JWT_ISSUER || 'https://auth.example.com',
          clockTolerance: 30, // 30 seconds clock skew tolerance
        }, (err, decoded) => {
          if (err) {
            reject(err);
          } else {
            resolve(decoded);
          }
        });
      });

      return decoded;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Get signing key from JWKS
   */
  private getKey(header: any, callback: any): void {
    this.jwksClient.getSigningKey(header.kid, (err: any, key: any) => {
      if (err) {
        callback(err, null);
      } else {
        const signingKey = key.publicKey || key.rsaPublicKey;
        callback(null, signingKey);
      }
    });
  }

  /**
   * Decode token without verification (for debugging)
   */
  decodeToken(token: string): any {
    return jwt.decode(token, { complete: true });
  }

  /**
   * Validate sender-constrained token binding
   */
  validateSenderConstraint(decoded: any, certificateFingerprint?: string, dpopProof?: string): boolean {
    // Check for certificate binding (mTLS)
    if (decoded.cnf && decoded.cnf['x5t#S256']) {
      if (!certificateFingerprint) {
        return false;
      }
      return decoded.cnf['x5t#S256'] === certificateFingerprint;
    }

    // Check for DPoP binding
    if (dpopProof) {
      // DPoP validation logic would go here
      return true;
    }

    // In sandbox, allow bearer tokens without sender constraint
    if (process.env.NODE_ENV === 'development') {
      return true;
    }

    return false;
  }
}