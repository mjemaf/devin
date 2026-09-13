import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Idempotency-Key decorator
 * 
 * Extracts the Idempotency-Key header value from the request
 * Used for idempotency handling
 */
export const IdempotencyKey = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.headers['idempotency-key'] as string || null;
  },
);