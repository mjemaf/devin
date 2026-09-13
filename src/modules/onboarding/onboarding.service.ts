import { Injectable, NotFoundException, ForbiddenException, ConflictException, PreconditionFailedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateApplicationDto, UpdateApplicationDto, SubmitApplicationDto } from './dto/create-application.dto';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * Application Lifecycle States
 */
const APPLICATION_STATES = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  IN_REVIEW: 'in_review',
  INFORMATION_REQUIRED: 'information_required',
  APPROVED: 'approved',
  APPROVED_WITH_CONDITIONS: 'approved_with_conditions',
  REFERRED: 'referred',
  DECLINED: 'declined',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;

/**
 * Valid state transitions
 */
const STATE_TRANSITIONS: Record<string, string[]> = {
  [APPLICATION_STATES.DRAFT]: [APPLICATION_STATES.SUBMITTED, APPLICATION_STATES.CANCELLED],
  [APPLICATION_STATES.SUBMITTED]: [APPLICATION_STATES.IN_REVIEW, APPLICATION_STATES.INFORMATION_REQUIRED, APPLICATION_STATES.CANCELLED],
  [APPLICATION_STATES.IN_REVIEW]: [APPLICATION_STATES.INFORMATION_REQUIRED, APPLICATION_STATES.APPROVED, APPLICATION_STATES.APPROVED_WITH_CONDITIONS, APPLICATION_STATES.REFERRED, APPLICATION_STATES.DECLINED],
  [APPLICATION_STATES.INFORMATION_REQUIRED]: [APPLICATION_STATES.SUBMITTED, APPLICATION_STATES.CANCELLED],
  [APPLICATION_STATES.APPROVED]: [APPLICATION_STATES.COMPLETED],
  [APPLICATION_STATES.APPROVED_WITH_CONDITIONS]: [APPLICATION_STATES.COMPLETED],
  [APPLICATION_STATES.REFERRED]: [APPLICATION_STATES.IN_REVIEW, APPLICATION_STATES.DECLINED],
  [APPLICATION_STATES.DECLINED]: [],
  [APPLICATION_STATES.COMPLETED]: [],
  [APPLICATION_STATES.CANCELLED]: [],
  [APPLICATION_STATES.EXPIRED]: [],
};

/**
 * Onboarding Service
 * 
 * Manages application lifecycle, requirements, and onboarding sessions
 */
@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new application
   */
  async createApplication(dto: CreateApplicationDto, userId: string, orgPath: string) {
    // Insert and then retrieve the created application
    const applicationId = await this.prisma.$executeRawUnsafe(
      `INSERT INTO applications (id, organization_id, merchant_name, merchant_legal_name, merchant_tax_id, merchant_phone, merchant_email, merchant_website, merchant_category, merchant_subcategory, merchant_address, processing_info, applicant_first_name, applicant_last_name, applicant_email, applicant_phone, applicant_title, application_type, referral_code, terms_accepted, terms_accepted_at, status, created_by, created_at, updated_at)
      VALUES (
        gen_random_text(),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        'draft',
        $21,
        NOW(),
        NOW()
      )
      RETURNING id`,
      dto.organizationId,
      dto.merchantName,
      dto.merchantLegalName || null,
      dto.merchantTaxId || null,
      dto.merchantPhone || null,
      dto.merchantEmail || null,
      dto.merchantWebsite || null,
      dto.merchantCategory || null,
      dto.merchantSubcategory || null,
      JSON.stringify(dto.merchantAddress) || null,
      JSON.stringify(dto.processingInfo) || null,
      dto.applicantFirstName || null,
      dto.applicantLastName || null,
      dto.applicantEmail || null,
      dto.applicantPhone || null,
      dto.applicantTitle || null,
      dto.applicationType || null,
      dto.referralCode || null,
      dto.termsAccepted || false,
      dto.termsAcceptedAt || null,
      userId,
    );

    const application = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM applications WHERE id = $1`,
      applicationId,
    ) as any[];

    // Initialize default requirements
    await this.initializeRequirements(application[0].id, dto.merchantCategory);

    return application[0];
  }

  /**
   * Get application by ID
   */
  async getApplication(id: string, orgPath: string) {
    const application = await this.prisma.$queryRawUnsafe(
      `SELECT a.*, o.path as org_path
       FROM applications a
       JOIN organizations o ON a.organization_id = o.id
       WHERE a.id = $1 AND o.path = $2
       LIMIT 1`,
      id,
      orgPath,
    ) as any[];

    if (!application || application.length === 0) {
      throw new NotFoundException('Application not found');
    }

    return application[0];
  }

  /**
   * List applications for an organization
   */
  async listApplications(organizationId: string, orgPath: string, options: {
    status?: string;
    limit?: number;
    cursor?: string;
  }) {
    const limit = options.limit || 50;
    let queryParams: any[] = [organizationId, orgPath];
    let query = `
      SELECT a.*, o.path as org_path
      FROM applications a
      JOIN organizations o ON a.organization_id = o.id
      WHERE a.organization_id = $1 AND o.path = $2
    `;

    if (options.status) {
      query += ` AND a.status = $${queryParams.length + 1}`;
      queryParams.push(options.status);
    }

    if (options.cursor) {
      query += ` AND a.id > $${queryParams.length + 1}`;
      queryParams.push(options.cursor);
    }

    query += ` ORDER BY a.created_at DESC LIMIT $${queryParams.length + 1}`;
    queryParams.push(limit);

    const applications = await this.prisma.$queryRawUnsafe(query, ...queryParams) as any[];

    return {
      data: applications,
      cursor: applications.length > 0 ? applications[applications.length - 1].id : null,
      hasMore: applications.length === limit,
    };
  }

  /**
   * Update application
   */
  async updateApplication(id: string, dto: UpdateApplicationDto, orgPath: string, ifMatch?: string) {
    const application = await this.getApplication(id, orgPath);

    // Validate ETag if provided
    if (ifMatch) {
      const currentETag = this.generateETag(application);
      if (!this.validateETag(ifMatch, currentETag)) {
        throw new PreconditionFailedException({
          type: 'https://api.example.com/errors/precondition-failed',
          title: 'Precondition Failed',
          status: 412,
          code: 'etag_mismatch',
          detail: 'ETag in If-Match header does not match current resource version',
          instance: `/v1/applications/${id}`,
          request_id: id,
          retryable: false,
        });
      }
    }

    // Only draft and information_required applications are editable
    if (application.status !== APPLICATION_STATES.DRAFT && application.status !== APPLICATION_STATES.INFORMATION_REQUIRED) {
      throw new ForbiddenException('Application is not in an editable state');
    }

    const updateFields: string[] = [];
    const values: any[] = [];

    if (dto.merchantName) {
      updateFields.push('merchant_name = $2');
      values.push(dto.merchantName);
    }
    if (dto.merchantLegalName) {
      updateFields.push('merchant_legal_name = $3');
      values.push(dto.merchantLegalName);
    }
    if (dto.merchantTaxId) {
      updateFields.push('merchant_tax_id = $4');
      values.push(dto.merchantTaxId);
    }
    if (dto.merchantPhone) {
      updateFields.push('merchant_phone = $5');
      values.push(dto.merchantPhone);
    }
    if (dto.merchantEmail) {
      updateFields.push('merchant_email = $6');
      values.push(dto.merchantEmail);
    }
    if (dto.merchantWebsite) {
      updateFields.push('merchant_website = $7');
      values.push(dto.merchantWebsite);
    }
    if (dto.merchantCategory) {
      updateFields.push('merchant_category = $8');
      values.push(dto.merchantCategory);
    }
    if (dto.merchantSubcategory) {
      updateFields.push('merchant_subcategory = $9');
      values.push(dto.merchantSubcategory);
    }
    if (dto.merchantAddress) {
      updateFields.push('merchant_address = $10');
      values.push(JSON.stringify(dto.merchantAddress));
    }
    if (dto.processingInfo) {
      updateFields.push('processing_info = $11');
      values.push(JSON.stringify(dto.processingInfo));
    }
    if (dto.applicantFirstName) {
      updateFields.push('applicant_first_name = $12');
      values.push(dto.applicantFirstName);
    }
    if (dto.applicantLastName) {
      updateFields.push('applicant_last_name = $13');
      values.push(dto.applicantLastName);
    }
    if (dto.applicantEmail) {
      updateFields.push('applicant_email = $14');
      values.push(dto.applicantEmail);
    }
    if (dto.applicantPhone) {
      updateFields.push('applicant_phone = $15');
      values.push(dto.applicantPhone);
    }
    if (dto.applicantTitle) {
      updateFields.push('applicant_title = $16');
      values.push(dto.applicantTitle);
    }

    if (updateFields.length === 0) {
      return application;
    }

    updateFields.push('updated_at = NOW()');
    updateFields.push('version = version + 1');
    values.push(id);

    await this.prisma.$executeRawUnsafe(
      `UPDATE applications
       SET ${updateFields.join(', ')}
       WHERE id = $${values.length}`,
      ...values,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM applications WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Submit application
   */
  async submitApplication(id: string, dto: SubmitApplicationDto, orgPath: string) {
    const application = await this.getApplication(id, orgPath);

    if (application.status !== APPLICATION_STATES.DRAFT && application.status !== APPLICATION_STATES.INFORMATION_REQUIRED) {
      throw new ForbiddenException('Application is not in a submittable state');
    }

    if (!dto.termsAccepted) {
      throw new ConflictException('Terms must be accepted to submit application');
    }

    // Check if all required requirements are satisfied
    const requirements = await this.getRequirements(id);
    const unsatisfied = requirements.filter((r: any) => r.is_required && r.status !== 'satisfied');

    if (unsatisfied.length > 0) {
      throw new ConflictException('All required requirements must be satisfied before submission');
    }

    // Transition to submitted state
    await this.prisma.$executeRawUnsafe(
      `UPDATE applications
       SET 
         status = 'submitted',
         terms_accepted = true,
         terms_accepted_at = $2,
         submitted_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      id,
      dto.termsAcceptedAt || new Date(),
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM applications WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Transition application state
   */
  async transitionState(id: string, newState: string, reason?: string, orgPath?: string) {
    const application = await this.getApplication(id, orgPath || '');

    const validTransitions = STATE_TRANSITIONS[application.status] || [];
    if (!validTransitions.includes(newState)) {
      throw new ForbiddenException(`Cannot transition from ${application.status} to ${newState}`);
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE applications
       SET 
         status = $2,
         updated_at = NOW()
       WHERE id = $1`,
      id,
      newState,
    );

    // Log state transition
    await this.logStateTransition(id, application.status, newState, reason);

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM applications WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Get requirements for an application
   */
  async getRequirements(applicationId: string) {
    const result = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM requirements
       WHERE application_id = $1
       ORDER BY is_required DESC, due_date ASC`,
      applicationId,
    );
    return result as any[];
  }

  /**
   * Initialize default requirements for an application
   */
  private async initializeRequirements(applicationId: string, merchantCategory?: string) {
    const defaultRequirements = this.getDefaultRequirements(merchantCategory);

    for (const req of defaultRequirements) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO requirements (id, application_id, requirement_type, title, description, is_required, status, due_date, created_at, updated_at)
         VALUES (
           gen_random_text(),
           $1,
           $2,
           $3,
           $4,
           $5,
           'pending',
           NOW() + INTERVAL '7 days',
           NOW(),
           NOW()
         )`,
        applicationId,
        req.type,
        req.title,
        req.description,
        req.isRequired,
      );
    }
  }

  /**
   * Get default requirements based on merchant category
   */
  private getDefaultRequirements(category?: string): Array<{
    type: string;
    title: string;
    description: string;
    isRequired: boolean;
  }> {
    const baseRequirements = [
      {
        type: 'business_info',
        title: 'Business Information',
        description: 'Complete business registration details',
        isRequired: true,
      },
      {
        type: 'owner_info',
        title: 'Owner Information',
        description: 'Personal information for all beneficial owners',
        isRequired: true,
      },
      {
        type: 'bank_account',
        title: 'Bank Account',
        description: 'Valid bank account for settlements',
        isRequired: true,
      },
      {
        type: 'tax_id',
        title: 'Tax ID',
        description: 'Valid tax identification number',
        isRequired: true,
      },
    ];

    if (category === 'healthcare') {
      baseRequirements.push({
        type: 'hipaa_compliance',
        title: 'HIPAA Compliance',
        description: 'HIPAA compliance documentation',
        isRequired: true,
      });
    }

    if (category === 'ecommerce') {
      baseRequirements.push({
        type: 'website_url',
        title: 'Website URL',
        description: 'Valid e-commerce website',
        isRequired: true,
      });
    }

    return baseRequirements;
  }

  /**
   * Log state transition
   */
  private async logStateTransition(applicationId: string, fromState: string, toState: string, reason?: string) {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO audit_logs (id, subject_type, subject_id, action, actor, metadata, created_at)
       VALUES (
         gen_random_text(),
         'application',
         $1,
         'state_transition',
         'system',
         $2,
         NOW()
       )`,
      applicationId,
      JSON.stringify({ from: fromState, to: toState, reason }),
    );
  }

  /**
   * Generate ETag from resource
   */
  private generateETag(resource: any): string {
    const hash = crypto
      .createHash('md5')
      .update(JSON.stringify(resource))
      .digest('hex');
    return `"${hash}"`;
  }

  /**
   * Validate ETag matches
   */
  private validateETag(ifMatch: string, currentETag: string): boolean {
    const cleanIfMatch = ifMatch.replace(/"/g, '');
    const cleanCurrentETag = currentETag.replace(/"/g, '');
    
    if (cleanIfMatch === '*') {
      return true;
    }

    return cleanIfMatch === cleanCurrentETag;
  }
}
