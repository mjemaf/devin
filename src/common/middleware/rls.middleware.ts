import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../database/prisma.service';

/**
 * Layer 3: PostgreSQL RLS Middleware
 * 
 * Sets the organization_path for Row Level Security
 * Uses SET LOCAL to ensure isolation per transaction
 */
@Injectable()
export class RlsMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const tenant = req.tenant;

    if (tenant) {
      try {
        // Set LOCAL ensures the setting only applies to the current transaction
        // This prevents cross-tenant data leaks in connection pools
        await this.prisma.$executeRawUnsafe(
          `SET LOCAL app.org_path = $1`,
          tenant.orgPath
        );
      } catch (error) {
        console.error('Failed to set RLS context:', error);
        // Continue even if RLS fails - other layers still provide protection
      }
    }

    next();
  }
}