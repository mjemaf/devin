import { Injectable, NestInterceptor, ExecutionContext, CallHandler, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Observable, catchError } from 'rxjs';

/**
 * Cross-Tenant Probing Protection Interceptor
 * 
 * Converts 403 errors to 404 for resources outside the caller's subtree
 * This prevents id enumeration from becoming portfolio reconnaissance
 */
@Injectable()
export class CrossTenantProtectionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        // If error is 403 Forbidden, convert to 404 Not Found
        // This makes it impossible to determine if a resource exists in another tenant
        if (error instanceof ForbiddenException) {
          throw new NotFoundException('Resource not found');
        }
        // Also handle HTTP status 403
        if (error.status === 403) {
          throw new NotFoundException('Resource not found');
        }
        throw error;
      })
    );
  }
}