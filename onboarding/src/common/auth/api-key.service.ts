import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { apiKeyPrefix, generateApiKey, hashApiKey } from '../crypto.util';
import { AuthContext, Role, SCOPES_BY_ROLE, Scope } from './auth.types';

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(partnerId: string, name: string, role: Role = 'operator') {
    const apiKey = generateApiKey('sandbox');
    const record = await this.prisma.apiKey.create({
      data: {
        partnerId,
        name,
        role,
        prefix: apiKeyPrefix(apiKey),
        keyHash: hashApiKey(apiKey),
        scopes: SCOPES_BY_ROLE[role],
      },
    });
    return { id: record.id, apiKey };
  }

  /** Resolves a raw API key to its auth context, or null when unknown/revoked. */
  async authenticate(rawKey: string): Promise<AuthContext | null> {
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(rawKey) },
      include: { partner: true },
    });
    if (!record || record.revokedAt || !record.partner.isActive) {
      return null;
    }
    await this.prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      partnerId: record.partnerId,
      partnerPublicId: record.partner.publicId,
      apiKeyId: record.id,
      role: record.role as Role,
      scopes: record.scopes as Scope[],
    };
  }
}
