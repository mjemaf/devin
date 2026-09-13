import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateRequirementDto, UpdateRequirementDto, RequirementStatus } from './dto/requirement.dto';
import { Prisma } from '@prisma/client';

/**
 * Requirements Service
 * 
 * Manages dynamic requirements for applications
 */
@Injectable()
export class RequirementsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a requirement for an application
   */
  async createRequirement(applicationId: string, dto: CreateRequirementDto) {
    const requirementId = await this.prisma.$executeRawUnsafe(
      `INSERT INTO requirements (id, application_id, requirement_type, title, description, is_required, status, due_date, created_at, updated_at)
       VALUES (
         gen_random_text(),
         $1,
         $2,
         $3,
         $4,
         $5,
         'pending',
         $6,
         NOW(),
         NOW()
       )
       RETURNING id`,
      applicationId,
      dto.requirementType,
      dto.title,
      dto.description || null,
      dto.isRequired !== undefined ? dto.isRequired : true,
      dto.dueDate || null,
    );

    const requirement = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM requirements WHERE id = $1`,
      requirementId,
    ) as any[];

    return requirement[0];
  }

  /**
   * Get requirement by ID
   */
  async getRequirement(id: string) {
    const requirement = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM requirements WHERE id = $1 LIMIT 1`,
      id,
    ) as any[];

    if (!requirement || requirement.length === 0) {
      throw new NotFoundException('Requirement not found');
    }

    return requirement[0];
  }

  /**
   * Update requirement
   */
  async updateRequirement(id: string, dto: UpdateRequirementDto) {
    const existing = await this.getRequirement(id);

    const updateFields: string[] = [];
    const values: any[] = [];

    if (dto.title) {
      updateFields.push('title = $2');
      values.push(dto.title);
    }
    if (dto.description) {
      updateFields.push('description = $3');
      values.push(dto.description);
    }
    if (dto.isRequired !== undefined) {
      updateFields.push('is_required = $4');
      values.push(dto.isRequired);
    }
    if (dto.status) {
      updateFields.push('status = $5');
      values.push(dto.status);
    }
    if (dto.dueDate) {
      updateFields.push('due_date = $6');
      values.push(dto.dueDate);
    }
    if (dto.waivedReason) {
      updateFields.push('waived_reason = $7');
      values.push(dto.waivedReason);
    }

    if (updateFields.length === 0) {
      return existing;
    }

    updateFields.push('updated_at = NOW()');
    values.push(id);

    await this.prisma.$executeRawUnsafe(
      `UPDATE requirements
       SET ${updateFields.join(', ')}
       WHERE id = $${values.length}`,
      ...values,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM requirements WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Delete requirement
   */
  async deleteRequirement(id: string) {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM requirements WHERE id = $1`,
      id,
    );
  }

  /**
   * Get requirements for an application
   */
  async getApplicationRequirements(applicationId: string) {
    const result = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM requirements
       WHERE application_id = $1
       ORDER BY is_required DESC, due_date ASC`,
      applicationId,
    );
    return result as any[];
  }

  /**
   * Mark requirement as satisfied
   */
  async satisfyRequirement(id: string, documentId?: string) {
    await this.prisma.$executeRawUnsafe(
      `UPDATE requirements
       SET 
         status = 'satisfied',
         satisfied_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      id,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM requirements WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Waive requirement
   */
  async waiveRequirement(id: string, reason: string) {
    await this.prisma.$executeRawUnsafe(
      `UPDATE requirements
       SET 
         status = 'waived',
         waived_reason = $2,
         waived_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      id,
      reason,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM requirements WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Check if all required requirements are satisfied
   */
  async checkRequirementsSatisfied(applicationId: string): Promise<boolean> {
    const requirements = await this.getApplicationRequirements(applicationId) as any[];
    const required = requirements.filter((r: any) => r.is_required);
    const satisfied = required.filter((r: any) => r.status === 'satisfied');
    
    return required.length === satisfied.length;
  }

  /**
   * Get unsatisfied requirements
   */
  async getUnsatisfiedRequirements(applicationId: string) {
    const requirements = await this.getApplicationRequirements(applicationId) as any[];
    return requirements.filter((r: any) => r.is_required && r.status !== 'satisfied');
  }
}
