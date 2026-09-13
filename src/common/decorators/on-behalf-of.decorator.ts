import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * On-Behalf-Of decorator
 * 
 * Extracts the On-Behalf-Of header value from the request
 * Used for delegation to descendant organizations
 */
export const OnBehalfOf = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.headers['on-behalf-of'] as string || null;
  },
);