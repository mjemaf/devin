import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuditLoggingInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const auditData = {
      merchantId: request.params.merchantId || request.body.merchant_id,
      actorId: request.headers['x-partner-id'] || request.user?.userId,
      actorType: request.user ? 'user' : 'partner',
      action: `${request.method} ${request.route?.path || request.url}`,
      resourceType: this.getResourceType(request.url),
      resourceId: request.params.merchantId || request.params.ownerId || request.params.bankAccountId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };

    return next.handle().pipe(
      tap(async () => {
        try {
          await this.prisma.auditLog.create({
            data: auditData,
          });
        } catch (error) {
          console.error('Failed to create audit log:', error);
        }
      }),
    );
  }

  private getResourceType(url: string): string {
    if (url.includes('/merchants')) return 'merchant';
    if (url.includes('/owners')) return 'owner';
    if (url.includes('/bank-accounts')) return 'bank_account';
    if (url.includes('/documents')) return 'document';
    if (url.includes('/webhooks')) return 'webhook';
    return 'unknown';
  }
}