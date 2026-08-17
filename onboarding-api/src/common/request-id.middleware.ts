import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { AuthenticatedRequest, } from '../auth/auth-context';
import { newId } from './ids';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : newId('request');
    req.headers['x-request-id'] = requestId;
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
