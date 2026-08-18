import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { newRequestId } from '../util/references';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const requestId = req.header('x-request-id') ?? newRequestId();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
