import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { Prisma } from '@prisma/client';
import { Principal } from '../auth/principal';
import { ApiException } from '../errors/api.exception';
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from '../util/crypto';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Replays the stored response when a partner retries a mutating call with the same
 * `Idempotency-Key`, and rejects the key if it is reused with a different body.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { principal?: Principal }>();
    const response = http.getResponse<Response>();
    const key = request.header('idempotency-key');

    if (!key || !MUTATING_METHODS.has(request.method) || !request.principal) {
      return next.handle();
    }

    const partnerId = request.principal.partnerId;
    const requestHash = sha256(JSON.stringify(request.body ?? {}));

    return from(this.prisma.idempotencyKey.findUnique({ where: { partnerId_key: { partnerId, key } } })).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw ApiException.conflict(
              'idempotency_key_reuse',
              'This Idempotency-Key was already used with a different request body.',
            );
          }
          response.status(existing.statusCode);
          response.setHeader('Idempotent-Replay', 'true');
          return of(existing.responseBody);
        }

        return next.handle().pipe(
          tap((body) => {
            void this.persist({
              partnerId,
              key,
              method: request.method,
              path: request.originalUrl,
              requestHash,
              statusCode: response.statusCode,
              responseBody: body as Prisma.InputJsonValue,
            });
          }),
        );
      }),
    );
  }

  private async persist(data: {
    partnerId: string;
    key: string;
    method: string;
    path: string;
    requestHash: string;
    statusCode: number;
    responseBody: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.idempotencyKey
      .create({ data })
      .catch(() => undefined);
  }
}
