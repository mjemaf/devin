import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { Principal } from './principal';

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
  return request.principal;
});
