import { Injectable, CanActivate, ExecutionContext, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Request } from 'express';
import { IdempotencyService } from '../services/idempotency.service';

/**
 * Mandatory Idempotency Guard
 * 
 * Enforces idempotency requirements on all mutating operations
 * Every POST, PUT, PATCH, DELETE request must have an Idempotency-Key header
 */
@Injectable()
export class IdempotencyGuard implements CanActivate {
  constructor(private idempotencyService: IdempotencyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;
    const tenant = request.tenant;

    // Only enforce idempotency on mutating operations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return true;
    }

    const idempotencyKey = request.headers['idempotency-key'] as string;

    if (!idempotencyKey) {
      throw new ConflictException({
        type: 'https://docs.example.com/errors/idempotency-key-required',
        title: 'Idempotency Key Required',
        status: 409,
        code: 'idempotency_key_required',
        detail: 'All mutating requests require an Idempotency-Key header',
        instance: request.url,
        retryable: false,
      });
    }

    // Validate UUIDv7 format (time-ordered, collision-free)
    if (!this.isValidUuidV7(idempotencyKey)) {
      throw new ConflictException({
        type: 'https://docs.example.com/errors/invalid-idempotency-key',
        title: 'Invalid Idempotency Key',
        status: 409,
        code: 'invalid_idempotency_key',
        detail: 'Idempotency-Key must be a valid UUIDv7',
        instance: request.url,
        retryable: false,
      });
    }

    if (!tenant) {
      throw new InternalServerErrorException('Tenant information not available');
    }

    const endpoint = this.getEndpoint(request);
    const organizationId = tenant.orgId;

    // Check if this key is already being processed
    const inProgress = await this.idempotencyService.isInProgress(
      idempotencyKey,
      organizationId,
      endpoint
    );

    if (inProgress) {
      throw new ConflictException({
        type: 'https://docs.example.com/errors/idempotency-request-in-progress',
        title: 'Idempotency Request In Progress',
        status: 409,
        code: 'idempotency_request_in_progress',
        detail: 'A request with this idempotency key is currently being processed',
        instance: request.url,
        retryable: true,
      });
    }

    // Store the idempotency context for use in subsequent middleware
    request.idempotency = {
      key: idempotencyKey,
      organizationId,
      endpoint,
    };

    return true;
  }

  private isValidUuidV7(key: string): boolean {
    // UUIDv7 format: 0193xxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    const uuidv7Regex = /^019[0-9a-f]{7}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidv7Regex.test(key);
  }

  private getEndpoint(request: Request): string {
    // Extract the endpoint path (e.g., /applications, /merchants/:id)
    return request.path;
  }
}

/**
 * Extend Express Request type to include idempotency information
 */
declare global {
  namespace Express {
    interface Request {
      idempotency?: {
        key: string;
        organizationId: string;
        endpoint: string;
      };
    }
  }
}