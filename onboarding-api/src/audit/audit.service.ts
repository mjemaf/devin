import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContext } from '../auth/auth-context';
import { newId } from '../common/ids';

export interface AuditEntry {
  merchantId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  changes?: Prisma.InputJsonValue;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(auth: AuthContext | null, entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          id: newId('audit'),
          merchantId: entry.merchantId ?? null,
          actorId: auth?.actorId ?? 'system',
          actorType: (auth?.actorType ?? 'system') as ActorType,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          changes: entry.changes,
          requestId: entry.requestId ?? auth?.requestId ?? null,
          ipAddress: entry.ipAddress ?? auth?.ipAddress ?? null,
          userAgent: entry.userAgent ?? auth?.userAgent ?? null,
        },
      });
    } catch (error) {
      // Audit must never break the business operation; surface it in logs instead.
      this.logger.error({ err: error, action: entry.action }, 'audit_write_failed');
    }
  }

  async listForMerchant(merchantId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
