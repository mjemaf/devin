import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { randomToken, sha256 } from '../util/crypto';
import { PartnerRole, Principal, Scope } from './principal';

export interface IssuedApiKey {
  id: string;
  prefix: string;
  /** Full secret, returned exactly once at creation time. */
  secret: string;
  scopes: Scope[];
  role: PartnerRole;
  livemode: boolean;
}

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async issue(input: {
    partnerId: string;
    scopes: Scope[];
    role?: PartnerRole;
    livemode?: boolean;
  }): Promise<IssuedApiKey> {
    const livemode = input.livemode ?? false;
    const prefix = `sk_${livemode ? 'live' : 'test'}_${randomToken(8)}`;
    const secret = `${prefix}.${randomToken(24)}`;

    const record = await this.prisma.apiKey.create({
      data: {
        partnerId: input.partnerId,
        prefix,
        keyHash: sha256(secret),
        scopes: input.scopes,
        role: input.role ?? 'operator',
        livemode,
      },
    });

    return {
      id: record.id,
      prefix,
      secret,
      scopes: input.scopes,
      role: (input.role ?? 'operator') as PartnerRole,
      livemode,
    };
  }

  async revoke(prefix: string): Promise<void> {
    await this.prisma.apiKey.updateMany({
      where: { prefix, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Resolves a raw `sk_test_<prefix>.<secret>` credential to its principal. */
  async resolve(rawKey: string): Promise<Principal | null> {
    const [prefix] = rawKey.split('.');
    if (!prefix) {
      return null;
    }

    const record = await this.prisma.apiKey.findUnique({
      where: { prefix },
      include: { partner: true },
    });

    if (!record || record.revokedAt || !record.partner.isActive) {
      return null;
    }
    if (record.keyHash !== sha256(rawKey)) {
      return null;
    }

    await this.touch(record);

    return {
      partnerId: record.partnerId,
      actorId: record.prefix,
      actorType: 'api_key',
      role: record.role as PartnerRole,
      scopes: record.scopes as Scope[],
      livemode: record.livemode,
    };
  }

  isAdminKey(rawKey: string): boolean {
    const adminKey = this.config.get<string>('adminApiKey');
    return Boolean(adminKey) && rawKey === adminKey;
  }

  private async touch(record: ApiKey): Promise<void> {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (record.lastUsedAt && record.lastUsedAt.getTime() > fiveMinutesAgo) {
      return;
    }
    await this.prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
  }
}
