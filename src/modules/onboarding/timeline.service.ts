import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Timeline Service
 * 
 * Manages application timeline and audit trail
 */
@Injectable()
export class TimelineService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get application timeline
   */
  async getTimeline(applicationId: string, orgPath: string) {
    const timeline = await this.prisma.$queryRawUnsafe(
      `SELECT 
        al.*,
        CASE 
          WHEN al.action = 'state_transition' THEN 'state_change'
          WHEN al.action = 'requirement_created' THEN 'requirement'
          WHEN al.action = 'requirement_satisfied' THEN 'requirement'
          WHEN al.action = 'document_uploaded' THEN 'document'
          WHEN al.action = 'document_updated' THEN 'document'
          WHEN al.action = 'document_validated' THEN 'document'
          ELSE 'general'
        END as event_type
      FROM audit_logs al
      JOIN applications a ON al.subject_id = a.id
      JOIN organizations o ON a.organization_id = o.id
      WHERE al.subject_id = $1 
        AND al.subject_type = 'application'
        AND o.path = $2
      ORDER BY al.created_at ASC`,
      applicationId,
      orgPath,
    );
    const timelineArray = timeline as any[];

    // Format timeline events
    const events = timelineArray.map((event: any) => {
      const metadata = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;
      
      return {
        id: event.id,
        eventType: event.event_type,
        action: event.action,
        actor: event.actor,
        timestamp: event.created_at,
        metadata: metadata,
      };
    });

    return events;
  }

  /**
   * Add timeline event
   */
  async addTimelineEvent(applicationId: string, eventType: string, action: string, actor: string, metadata?: any) {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO audit_logs (id, subject_type, subject_id, action, actor, metadata, created_at)
       VALUES (
         gen_random_text(),
         'application',
         $1,
         $2,
         $3,
         $4,
         NOW()
       )`,
      applicationId,
      action,
      actor,
      JSON.stringify(metadata) || null,
    );
  }

  /**
   * Get state transition history
   */
  async getStateTransitions(applicationId: string, orgPath: string) {
    const transitions = await this.prisma.$queryRawUnsafe(
      `SELECT 
        al.*,
        al.metadata::jsonb as metadata
      FROM audit_logs al
      JOIN applications a ON al.subject_id = a.id
      JOIN organizations o ON a.organization_id = o.id
      WHERE al.subject_id = $1 
        AND al.subject_type = 'application'
        AND al.action = 'state_transition'
        AND o.path = $2
      ORDER BY al.created_at ASC`,
      applicationId,
      orgPath,
    );
    const transitionsArray = transitions as any[];

    return transitionsArray.map((t: any) => ({
      id: t.id,
      from: t.metadata?.from,
      to: t.metadata?.to,
      reason: t.metadata?.reason,
      actor: t.actor,
      timestamp: t.created_at,
    }));
  }

  /**
   * Get requirement history
   */
  async getRequirementHistory(applicationId: string, orgPath: string) {
    const history = await this.prisma.$queryRawUnsafe(
      `SELECT 
        al.*,
        al.metadata::jsonb as metadata
      FROM audit_logs al
      JOIN applications a ON al.subject_id = a.id
      JOIN organizations o ON a.organization_id = o.id
      WHERE al.subject_id = $1 
        AND al.subject_type = 'application'
        AND (al.action = 'requirement_created' OR al.action = 'requirement_satisfied' OR al.action = 'requirement_waived')
        AND o.path = $2
      ORDER BY al.created_at ASC`,
      applicationId,
      orgPath,
    );
    const historyArray = history as any[];

    return historyArray.map((h: any) => ({
      id: h.id,
      action: h.action,
      requirementId: h.metadata?.requirementId,
      requirementType: h.metadata?.requirementType,
      actor: h.actor,
      timestamp: h.created_at,
    }));
  }

  /**
   * Get document history
   */
  async getDocumentHistory(applicationId: string, orgPath: string) {
    const history = await this.prisma.$queryRawUnsafe(
      `SELECT 
        al.*,
        al.metadata::jsonb as metadata
      FROM audit_logs al
      JOIN applications a ON al.subject_id = a.id
      JOIN organizations o ON a.organization_id = o.id
      WHERE al.subject_id = $1 
        AND al.subject_type = 'application'
        AND (al.action = 'document_uploaded' OR al.action = 'document_updated' OR al.action = 'document_validated')
        AND o.path = $2
      ORDER BY al.created_at ASC`,
      applicationId,
      orgPath,
    );
    const historyArray = history as any[];

    return historyArray.map((h: any) => ({
      id: h.id,
      action: h.action,
      documentId: h.metadata?.documentId,
      documentType: h.metadata?.documentType,
      status: h.metadata?.status,
      actor: h.actor,
      timestamp: h.created_at,
    }));
  }
}
