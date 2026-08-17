import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthContext, SCOPES_BY_ROLE } from './auth.types';

interface OnboardingTokenClaims {
  sub: string;
  partner_id: string;
  partner_public_id: string;
  api_key_id: string;
}

/**
 * Short-lived merchant-scoped JWT handed to embedded / white-label clients so a
 * browser can finish onboarding without holding a partner API key.
 */
@Injectable()
export class OnboardingTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issue(auth: AuthContext, merchantPublicId: string): Promise<string> {
    const claims: OnboardingTokenClaims = {
      sub: merchantPublicId,
      partner_id: auth.partnerId,
      partner_public_id: auth.partnerPublicId,
      api_key_id: auth.apiKeyId,
    };
    return this.jwt.signAsync(claims, {
      expiresIn: this.config.get<number>('onboardingTokenTtl', 86400),
    });
  }

  async verify(token: string): Promise<AuthContext | null> {
    try {
      const claims = await this.jwt.verifyAsync<OnboardingTokenClaims>(token);
      return {
        partnerId: claims.partner_id,
        partnerPublicId: claims.partner_public_id,
        apiKeyId: claims.api_key_id,
        role: 'operator',
        scopes: SCOPES_BY_ROLE.operator,
        merchantPublicId: claims.sub,
      };
    } catch {
      return null;
    }
  }
}
