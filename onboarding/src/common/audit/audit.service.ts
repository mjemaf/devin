import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../auth/principal';
import { RequestContext } from '../context/request-context';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string;
  merchantId?: string;
  changes?: Record<string, unknown>;
}

/**
 * Append-only trail behind every state change; the compliance guides treat this
 * table as the system of record for regulator-facing audit questions.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    principal: Principal | null,
    entry: AuditEntry,
    context: RequestContext = {},
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        merchantId: entry.merchantId ?? null,
        actorId: principal?.actorId ?? 'system',
        actorType: principal?.actorType ?? 'system',
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        changes: entry.changes ? JSON.parse(JSON.stringify(entry.changes)) : undefined,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        requestId: context.requestId ?? null,
      },
    });
  }
}
