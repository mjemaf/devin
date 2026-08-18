import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiException } from '../errors/api.exception';
import { PartnerRole, Principal, Scope } from './principal';

interface SessionClaims {
  sub: string;
  partner_id: string;
  merchant_reference: string;
  scopes: Scope[];
  role: PartnerRole;
  livemode: boolean;
}

/**
 * Short-lived JWTs handed to embedded UI and white-label flows so a browser can
 * complete onboarding for exactly one merchant without holding a partner API key.
 */
@Injectable()
export class SessionTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async mint(input: {
    partnerId: string;
    merchantReference: string;
    scopes: Scope[];
    role?: PartnerRole;
    livemode: boolean;
  }): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = this.config.get<number>('jwtTtlSeconds') ?? 3600;
    const claims: SessionClaims = {
      sub: input.merchantReference,
      partner_id: input.partnerId,
      merchant_reference: input.merchantReference,
      scopes: input.scopes,
      role: input.role ?? 'operator',
      livemode: input.livemode,
    };

    return { token: await this.jwt.signAsync(claims, { expiresIn }), expiresIn };
  }

  async verify(token: string): Promise<Principal> {
    try {
      const claims = await this.jwt.verifyAsync<SessionClaims>(token);
      return {
        partnerId: claims.partner_id,
        actorId: claims.sub,
        actorType: 'user',
        role: claims.role,
        scopes: claims.scopes,
        livemode: claims.livemode,
        merchantReference: claims.merchant_reference,
      };
    } catch {
      throw ApiException.unauthenticated(
        'invalid_session_token',
        'The onboarding session token is invalid or has expired.',
      );
    }
  }
}
