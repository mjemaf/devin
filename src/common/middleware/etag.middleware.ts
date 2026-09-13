import { Injectable, NestMiddleware, PreconditionFailedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

/**
 * ETag Middleware
 * 
 * Generates ETags for GET responses and validates If-Match/If-None-Match headers
 */
@Injectable()
export class ETagMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json to add ETag
    res.json = function (body: any) {
      // Generate ETag from response body
      const etag = ETagMiddleware.generateETag(body);
      
      // Check If-None-Match header for GET requests
      if (req.method === 'GET' && req.headers['if-none-match']) {
        const ifNoneMatch = req.headers['if-none-match'] as string;
        if (etag === ifNoneMatch) {
          res.status(304);
          res.setHeader('ETag', etag);
          return res.send();
        }
      }

      // Set ETag header
      res.setHeader('ETag', etag);
      
      // Call original json
      return originalJson(body);
    };

    // Validate If-Match header for PUT/PATCH/DELETE requests
    if (['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const ifMatch = req.headers['if-match'] as string;
      
      if (!ifMatch) {
        throw new PreconditionFailedException({
          type: 'https://api.example.com/errors/precondition-required',
          title: 'Precondition Required',
          status: 428,
          code: 'precondition_required',
          detail: 'If-Match header is required for this request',
          instance: req.url,
          request_id: req.id,
          retryable: false,
        });
      }

      // Store If-Match for validation in controller/service
      req.ifMatch = ifMatch;
    }

    next();
  }

  /**
   * Generate ETag from data
   */
  private static generateETag(data: any): string {
    const json = JSON.stringify(data);
    const hash = crypto
      .createHash('md5')
      .update(json)
      .digest('hex');
    return `"${hash}"`;
  }

  /**
   * Validate ETag matches
   */
  static validateETag(ifMatch: string, currentETag: string): boolean {
    // Remove quotes for comparison
    const cleanIfMatch = ifMatch.replace(/"/g, '');
    const cleanCurrentETag = currentETag.replace(/"/g, '');
    
    // Support wildcard
    if (cleanIfMatch === '*') {
      return true;
    }

    return cleanIfMatch === cleanCurrentETag;
  }
}

/**
 * Extend Express Request type
 */
declare global {
  namespace Express {
    interface Request {
      ifMatch?: string;
    }
  }
}
