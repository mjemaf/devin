import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable, of, tap } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest } from '../../auth/auth-context';
import { ApiException } from '../errors/api.exception';
import { sha256 } from '../crypto.util';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Replays the stored response when a partner retries a mutating call with the same
 * `Idempotency-Key`, and rejects reuse of a key with a different request body.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const key = request.headers['idempotency-key'];

    if (!MUTATING_METHODS.has(request.method) || typeof key !== 'string' || key.length === 0) {
      return next.handle();
    }
    if (!request.auth) return next.handle();

    const requestHash = sha256(
      `${request.method}:${request.originalUrl}:${JSON.stringify(request.body ?? {})}`,
    );
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } });

    if (existing) {
      if (existing.partnerId !== request.auth.partnerId || existing.requestHash !== requestHash) {
        throw ApiException.conflict(
          'idempotency_key_reused',
          'This Idempotency-Key was already used with a different request payload',
        );
      }
      http.getResponse<Response>().status(existing.statusCode).setHeader('Idempotent-Replayed', 'true');
      return of(existing.responseBody);
    }

    return next.handle().pipe(
      tap((body) => {
        void this.prisma.idempotencyKey
          .create({
            data: {
              key,
              partnerId: request.auth!.partnerId,
              method: request.method,
              path: request.originalUrl,
              requestHash,
              statusCode: http.getResponse<Response>().statusCode,
              responseBody: (body ?? {}) as Prisma.InputJsonValue,
            },
          })
          .catch(() => undefined);
      }),
    );
  }
}
