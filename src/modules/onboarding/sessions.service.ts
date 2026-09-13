import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateSessionDto, UpdateSessionDto, SessionStatus, SessionType } from './dto/session.dto';
import { Prisma } from '@prisma/client';

/**
 * Onboarding Sessions Service
 * 
 * Manages hosted and embedded onboarding sessions
 */
@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new onboarding session
   */
  async createSession(dto: CreateSessionDto, userId: string, orgPath: string) {
    // Verify application exists and belongs to organization
    const application = await this.prisma.$queryRawUnsafe(
      `SELECT a.*, o.path as org_path
       FROM applications a
       JOIN organizations o ON a.organization_id = o.id
       WHERE a.id = $1 AND o.path = $2
       LIMIT 1`,
      dto.applicationId,
      orgPath,
    ) as any[];

    if (!application || application.length === 0) {
      throw new NotFoundException('Application not found');
    }

    // Insert and then retrieve the created session
    const sessionId = await this.prisma.$executeRawUnsafe(
      `INSERT INTO onboarding_sessions (id, application_id, session_type, return_url, cancel_url, configuration, status, created_by, created_at, updated_at)
       VALUES (
         gen_random_text(),
         $1,
         $2,
         $3,
         $4,
         $5,
         'created',
         $6,
         NOW(),
         NOW()
       )
       RETURNING id`,
      dto.applicationId,
      dto.sessionType,
      dto.returnUrl || null,
      dto.cancelUrl || null,
      JSON.stringify(dto.configuration) || null,
      userId,
    );

    const session = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM onboarding_sessions WHERE id = $1`,
      sessionId,
    ) as any[];

    return session[0];
  }

  /**
   * Get session by ID
   */
  async getSession(id: string, orgPath: string) {
    const session = await this.prisma.$queryRawUnsafe(
      `SELECT s.*, o.path as org_path
       FROM onboarding_sessions s
       JOIN applications a ON s.application_id = a.id
       JOIN organizations o ON a.organization_id = o.id
       WHERE s.id = $1 AND o.path = $2
       LIMIT 1`,
      id,
      orgPath,
    ) as any[];

    if (!session || session.length === 0) {
      throw new NotFoundException('Session not found');
    }

    return session[0];
  }

  /**
   * Update session
   */
  async updateSession(id: string, dto: UpdateSessionDto, orgPath: string) {
    const existing = await this.getSession(id, orgPath);

    const updateFields: string[] = [];
    const values: any[] = [];

    if (dto.status) {
      updateFields.push('status = $2');
      values.push(dto.status);
    }
    if (dto.currentStep) {
      updateFields.push('current_step = $3');
      values.push(JSON.stringify(dto.currentStep));
    }
    if (dto.progress) {
      updateFields.push('progress = $4');
      values.push(JSON.stringify(dto.progress));
    }

    if (updateFields.length === 0) {
      return existing;
    }

    updateFields.push('updated_at = NOW()');
    values.push(id);

    await this.prisma.$executeRawUnsafe(
      `UPDATE onboarding_sessions
       SET ${updateFields.join(', ')}
       WHERE id = $${values.length}`,
      ...values,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM onboarding_sessions WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Start session
   */
  async startSession(id: string, orgPath: string) {
    const session = await this.getSession(id, orgPath);

    if (session.status !== SessionStatus.CREATED) {
      throw new ForbiddenException('Session has already been started');
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE onboarding_sessions
       SET 
         status = 'started',
         started_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      id,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM onboarding_sessions WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Complete session
   */
  async completeSession(id: string, orgPath: string) {
    const session = await this.getSession(id, orgPath);

    if (session.status !== SessionStatus.IN_PROGRESS) {
      throw new ForbiddenException('Session is not in progress');
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE onboarding_sessions
       SET 
         status = 'completed',
         completed_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      id,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM onboarding_sessions WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Abandon session
   */
  async abandonSession(id: string, orgPath: string) {
    const session = await this.getSession(id, orgPath);

    await this.prisma.$executeRawUnsafe(
      `UPDATE onboarding_sessions
       SET 
         status = 'abandoned',
         abandoned_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      id,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM onboarding_sessions WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * List sessions for an application
   */
  async listSessions(applicationId: string, orgPath: string) {
    const result = await this.prisma.$queryRawUnsafe(
      `SELECT s.*
       FROM onboarding_sessions s
       JOIN applications a ON s.application_id = a.id
       JOIN organizations o ON a.organization_id = o.id
       WHERE s.application_id = $1 AND o.path = $2
       ORDER BY s.created_at DESC`,
      applicationId,
      orgPath,
    );
    return result as any[];
  }

  /**
   * Get hosted session URL
   */
  async getHostedUrl(id: string, orgPath: string): Promise<string> {
    const session = await this.getSession(id, orgPath);

    if (session.session_type !== SessionType.HOSTED) {
      throw new ForbiddenException('Session is not a hosted session');
    }

    // Generate hosted URL with session token
    const baseUrl = process.env.HOSTED_ONBOARDING_URL || 'https://onboarding.example.com';
    return `${baseUrl}/session/${id}`;
  }

  /**
   * Get embedded session configuration
   */
  async getEmbeddedConfig(id: string, orgPath: string) {
    const session = await this.getSession(id, orgPath);

    if (session.session_type !== SessionType.EMBEDDED) {
      throw new ForbiddenException('Session is not an embedded session');
    }

    return {
      sessionId: session.id,
      applicationId: session.application_id,
      configuration: session.configuration,
      returnUrl: session.return_url,
      cancelUrl: session.cancel_url,
    };
  }

  /**
   * Check session expiry
   */
  async checkSessionExpiry(id: string): Promise<boolean> {
    const session = await this.prisma.$queryRawUnsafe(
      `SELECT expires_at FROM onboarding_sessions WHERE id = $1 LIMIT 1`,
      id,
    ) as any[];

    if (!session || session.length === 0) {
      return false;
    }

    if (session[0].expires_at && new Date(session[0].expires_at) < new Date()) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE onboarding_sessions SET status = 'expired' WHERE id = $1`,
        id,
      );
      return true;
    }

    return false;
  }
}
