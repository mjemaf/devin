import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from '../common/crypto.util';
import { ApiException } from '../common/errors/api.exception';
import { AuthContext, Role, Scope, SCOPES_BY_ROLE } from './auth-context';

const TOKEN_TTL_SECONDS = 3600;

interface JwtPayload {
  sub: string;
  partner_id: string;
  role: Role;
  scopes: Scope[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async authenticateApiKey(rawKey: string): Promise<AuthContext> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash: sha256(rawKey) },
      include: { partner: true },
    });

    if (!apiKey || !apiKey.isActive || !apiKey.partner.isActive) {
      throw ApiException.unauthenticated('The provided API key is invalid or inactive');
    }

    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      partnerId: apiKey.partnerId,
      actorId: apiKey.id,
      actorType: 'partner',
      role: apiKey.role as Role,
      scopes: this.effectiveScopes(apiKey.role as Role, apiKey.scopes as Scope[]),
      credential: 'api_key',
    };
  }

  async authenticateBearerToken(token: string): Promise<AuthContext> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw ApiException.unauthenticated('The provided access token is invalid or expired');
    }

    return {
      partnerId: payload.partner_id,
      actorId: payload.sub,
      actorType: 'user',
      role: payload.role,
      scopes: payload.scopes,
      credential: 'jwt',
    };
  }

  /** OAuth 2.0 client credentials: the API key is the client secret. */
  async issueClientCredentialsToken(
    clientId: string,
    clientSecret: string,
  ): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string }> {
    const auth = await this.authenticateApiKey(clientSecret);
    if (auth.partnerId !== clientId) {
      throw ApiException.unauthenticated('client_id does not match the supplied client_secret');
    }

    const payload: JwtPayload = {
      sub: auth.actorId,
      partner_id: auth.partnerId,
      role: auth.role,
      scopes: auth.scopes,
    };

    return {
      access_token: await this.jwt.signAsync(payload, { expiresIn: TOKEN_TTL_SECONDS }),
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      scope: auth.scopes.join(' '),
    };
  }

  /** A key never carries more than its role allows. */
  private effectiveScopes(role: Role, granted: Scope[]): Scope[] {
    const allowed = SCOPES_BY_ROLE[role] ?? SCOPES_BY_ROLE.viewer;
    return allowed.filter((scope) => granted.includes(scope));
  }
}
