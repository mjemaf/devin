import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Observable, from, map, switchMap } from 'rxjs';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../errors/api.exception';
import { AuthenticatedRequest } from '../auth/auth-context.decorator';

const REPLAYABLE_METHODS = new Set(['POST', 'PATCH', 'PUT']);

/**
 * Replays the stored response when a partner retries a mutating request with the
 * same `Idempotency-Key`, and rejects reuse of a key with a different payload.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const key = request.headers['idempotency-key'];

    if (!REPLAYABLE_METHODS.has(request.method) || typeof key !== 'string' || !request.auth) {
      return next.handle();
    }

    const partnerId = request.auth.partnerId;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ path: request.path, body: request.body ?? {} }))
      .digest('hex');

    return from(this.prisma.idempotencyKey.findUnique({ where: { partnerId_key: { partnerId, key } } })).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw ApiException.conflict(
              'Idempotency-Key was already used with a different request payload',
              'idempotency_key_reuse',
            );
          }
          response.status(existing.statusCode);
          response.setHeader('idempotent-replayed', 'true');
          return from([existing.responseBody]);
        }
        const statusCode =
          this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ??
          (request.method === 'POST' ? 201 : 200);

        return next.handle().pipe(
          switchMap((body) =>
            from(
              this.prisma.idempotencyKey.create({
                data: {
                  partnerId,
                  key,
                  method: request.method,
                  path: request.path,
                  requestHash,
                  statusCode,
                  responseBody: (body ?? {}) as Prisma.InputJsonValue,
                },
              }),
            ).pipe(map(() => body)),
          ),
        );
      }),
    );
  }
}
