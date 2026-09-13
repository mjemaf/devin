import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Request ID Middleware
 * 
 * Generates a unique request ID for tracing
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Generate or use existing request ID
    req.id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    
    // Set response header
    res.setHeader('X-Request-ID', req.id);
    
    next();
  }
}

/**
 * Extend Express Request type
 */
declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}
