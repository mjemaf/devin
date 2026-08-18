import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { ApiKeyService } from '../../common/auth/api-key.service';
import { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateApiKeyDto, CreatePartnerDto } from './dto/partner.dto';

/**
 * Platform-side provisioning. Partners are the tenants of the API: each one owns its
 * merchants, keys and webhook endpoints, which is what enforces data isolation.
 */
@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    private readonly audit: AuditService,
  ) {}

  async create(principal: Principal, dto: CreatePartnerDto, context: RequestContext) {
    const partner = await this.prisma.partner.create({
      data: {
        name: dto.name,
        integrationMode: dto.integration_mode,
        branding: dto.branding ? (dto.branding as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        defaultLocale: dto.default_locale ?? 'en-US',
      },
    });

    await this.audit.record(
      principal,
      {
        action: 'partner.created',
        resourceType: 'partner',
        resourceId: partner.id,
        changes: { name: dto.name, integration_mode: dto.integration_mode },
      },
      context,
    );

    return this.serialize(partner);
  }

  async list() {
    const partners = await this.prisma.partner.findMany({ orderBy: { createdAt: 'desc' } });
    return { data: partners.map((partner) => this.serialize(partner)) };
  }

  async issueApiKey(
    principal: Principal,
    partnerId: string,
    dto: CreateApiKeyDto,
    context: RequestContext,
  ) {
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) {
      throw ApiException.notFound('partner_not_found', `No partner found with id ${partnerId}.`);
    }

    const issued = await this.apiKeys.issue({
      partnerId: partner.id,
      scopes: dto.scopes,
      role: dto.role,
      livemode: dto.livemode,
    });

    await this.audit.record(
      principal,
      {
        action: 'partner.api_key_issued',
        resourceType: 'api_key',
        resourceId: issued.prefix,
        changes: { partner_id: partner.id, scopes: dto.scopes, role: issued.role },
      },
      context,
    );

    return {
      partner_id: partner.id,
      prefix: issued.prefix,
      /** Shown once. The platform only stores a SHA-256 hash of this value. */
      secret: issued.secret,
      scopes: issued.scopes,
      role: issued.role,
      livemode: issued.livemode,
    };
  }

  async listApiKeys(partnerId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: keys.map((key) => ({
        prefix: key.prefix,
        scopes: key.scopes,
        role: key.role,
        livemode: key.livemode,
        revoked_at: key.revokedAt,
        last_used_at: key.lastUsedAt,
        created_at: key.createdAt,
      })),
    };
  }

  async revokeApiKey(principal: Principal, prefix: string, context: RequestContext) {
    const key = await this.prisma.apiKey.findUnique({ where: { prefix } });
    if (!key) {
      throw ApiException.notFound('api_key_not_found', `No API key with prefix ${prefix}.`);
    }

    await this.apiKeys.revoke(prefix);
    await this.audit.record(
      principal,
      {
        action: 'partner.api_key_revoked',
        resourceType: 'api_key',
        resourceId: prefix,
        changes: { partner_id: key.partnerId },
      },
      context,
    );

    return { prefix, revoked: true };
  }

  private serialize(partner: {
    id: string;
    name: string;
    integrationMode: string;
    branding: unknown;
    defaultLocale: string;
    isActive: boolean;
    createdAt: Date;
  }) {
    return {
      id: partner.id,
      name: partner.name,
      integration_mode: partner.integrationMode,
      branding: partner.branding,
      default_locale: partner.defaultLocale,
      is_active: partner.isActive,
      created_at: partner.createdAt,
    };
  }
}
