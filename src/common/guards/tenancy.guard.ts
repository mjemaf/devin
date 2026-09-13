import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

/**
 * Three-Layer Tenancy Isolation Guard
 * 
 * Layer 1: Authorization guard - validates org_path from token
 * and On-Behalf-Of header for delegation
 */
@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as any;
    
    if (!user || !user.org_path) {
      throw new ForbiddenException('Organization path not found in token');
    }

    // Validate On-Behalf-Of header if present
    const onBehalfOf = request.headers['on-behalf-of'] as string;
    if (onBehalfOf) {
      this.validateOnBehalfOf(user.org_path, onBehalfOf);
    }

    // Store organization path for use in subsequent layers
    request.tenant = {
      orgPath: user.org_path,
      orgId: user.org,
      onBehalfOf: onBehalfOf || null,
    };

    return true;
  }

  private validateOnBehalfOf(orgPath: string, onBehalfOf: string): void {
    // Check if the On-Behalf-Of organization is a descendant of the token's organization
    // Simple string prefix check for hierarchy validation
    if (!onBehalfOf.startsWith(orgPath)) {
      throw new ForbiddenException('On-Behalf-Of organization is not in your subtree');
    }
  }
}

/**
 * Extend Express Request type to include tenant information
 */
declare global {
  namespace Express {
    interface Request {
      tenant?: {
        orgPath: string;
        orgId: string;
        onBehalfOf: string | null;
      };
    }
  }
}