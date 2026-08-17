import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContext } from '../auth/auth.types';

export interface AuditEntry {
  merchantId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  changes?: Prisma.InputJsonValue;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Append-only audit trail; failures never break the caller's request. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(auth: AuthContext, entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          merchantId: entry.merchantId ?? null,
          actorId: auth.apiKeyId,
          actorType: auth.merchantPublicId ? 'onboarding_token' : 'api_key',
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          changes: entry.changes,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          requestId: entry.requestId,
        },
      });
    } catch (error) {
      this.logger.error({ error, entry }, 'Failed to write audit log');
    }
  }
}
