import { Injectable, NestMiddleware, ConflictException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { IdempotencyService } from '../services/idempotency.service';

/**
 * Idempotency Middleware
 * 
 * Handles idempotency logic for mutating operations:
 * - Checks for existing responses and returns them with replay header
 * - Stores successful responses for replay
 * - Handles body mismatch conflicts
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  constructor(private idempotencyService: IdempotencyService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const idempotency = req.idempotency;

    if (!idempotency) {
      return next();
    }

    const { key, organizationId, endpoint } = idempotency;
    const idempotencyService = this.idempotencyService;

    // Check for existing response
    const existing = await this.idempotencyService.retrieve(
      key,
      organizationId,
      endpoint
    );

    if (existing) {
      // Return the existing response with replay header
      res.setHeader('Idempotency-Replayed', 'true');
      return res.status(existing.statusCode).json(existing.response);
    }

    // Mark the key as in progress
    await this.idempotencyService.markInProgress(key, organizationId, endpoint);

    // Store the original send function
    const originalSend = res.send.bind(res);

    // Override send to store successful responses
    res.send = function (body: any) {
      // Only store 2xx responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Store the response in Redis
        idempotencyService
          .store(
            key,
            organizationId,
            endpoint,
            body,
            res.statusCode,
            res.getHeaders() as Record<string, string>
          )
          .catch((error) => {
            console.error('Failed to store idempotency response:', error);
          });
      }

      return originalSend(body);
    };

    next();
  }
}