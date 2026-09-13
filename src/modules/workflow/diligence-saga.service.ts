import { Injectable, Logger } from '@nestjs/common';
import { WorkflowEngine, WorkflowConfig, WorkflowStep } from './workflow-engine.service';
import { VerificationService } from '../verification/verification.service';
import { PrismaService } from '../../database/prisma.service';

/**
 * Diligence Saga Workflow
 * 
 * Orchestrates the complete diligence process for merchant onboarding
 * including parallel verifications, risk assessment, and underwriting
 */
@Injectable()
export class DiligenceSagaService {
  private readonly logger = new Logger(DiligenceSagaService.name);

  constructor(
    private workflowEngine: WorkflowEngine,
    private verificationService: VerificationService,
    private prisma: PrismaService,
  ) {
    this.registerWorkflows();
  }

  /**
   * Register all diligence workflows
   */
  private registerWorkflows(): void {
    // Full diligence workflow
    this.workflowEngine.registerWorkflow({
      id: 'diligence-full',
      name: 'Full Diligence Workflow',
      steps: [
        {
          id: 'initiate-diligence',
          name: 'Initiate Diligence',
          execute: async (context) => {
            const { merchantId } = context.data;
            this.logger.log(`Initiating diligence for merchant: ${merchantId}`);
            
            // Update merchant status
            await this.prisma.$executeRawUnsafe(
              `UPDATE merchants SET status = 'pending_verification' WHERE id = $1`,
              merchantId,
            );

            return { initiatedAt: new Date() };
          },
          compensate: async (context, result) => {
            const { merchantId } = context.data;
            await this.prisma.$executeRawUnsafe(
              `UPDATE merchants SET status = 'draft' WHERE id = $1`,
              merchantId,
            );
          },
        },
        {
          id: 'business-verification',
          name: 'Business Verification',
          execute: async (context) => {
            const { merchantId } = context.data;
            const result = await this.verificationService.verifyBusiness(merchantId, {
              country: 'US',
              priority: 'normal',
            });
            return result;
          },
          parallel: true,
          dependsOn: ['initiate-diligence'],
          retryPolicy: { maxAttempts: 3, backoffMs: 2000 },
        },
        {
          id: 'identity-verification',
          name: 'Identity Verification',
          execute: async (context) => {
            const { merchantId, personId } = context.data;
            const result = await this.verificationService.verifyIdentity(merchantId, personId, {
              country: 'US',
            });
            return result;
          },
          parallel: true,
          dependsOn: ['initiate-diligence'],
          retryPolicy: { maxAttempts: 3, backoffMs: 2000 },
        },
        {
          id: 'bank-verification',
          name: 'Bank Account Verification',
          execute: async (context) => {
            const { merchantId, bankAccountId } = context.data;
            const result = await this.verificationService.verifyBankAccount(merchantId, bankAccountId, {
              country: 'US',
            });
            return result;
          },
          parallel: true,
          dependsOn: ['initiate-diligence'],
          retryPolicy: { maxAttempts: 3, backoffMs: 2000 },
        },
        {
          id: 'risk-assessment',
          name: 'Risk Assessment',
          execute: async (context) => {
            const { merchantId } = context.data;
            this.logger.log(`Performing risk assessment for merchant: ${merchantId}`);
            
            // Calculate risk score from verification results
            const businessResult = context.results.get('business-verification');
            const identityResult = context.results.get('identity-verification');
            const bankResult = context.results.get('bank-verification');

            const riskScore = this.calculateRiskScore({
              business: businessResult,
              identity: identityResult,
              bank: bankResult,
            });

            // Persist risk assessment
            await this.prisma.$executeRawUnsafe(
              `INSERT INTO riskAssessment (id, merchant_id, input_snapshot_hash, risk_score, risk_level, factors, assessment_type, created_at)
               VALUES (
                 gen_random_text(),
                 $1,
                 $2,
                 $3,
                 $4,
                 $5,
                 'initial',
                 NOW()
               )`,
              merchantId,
              this.generateSnapshotHash(context.data),
              riskScore.score,
              riskScore.level,
              JSON.stringify(riskScore.factors),
            );

            return riskScore;
          },
          dependsOn: ['business-verification', 'identity-verification', 'bank-verification'],
        },
        {
          id: 'underwriting-decision',
          name: 'Underwriting Decision',
          execute: async (context) => {
            const { merchantId } = context.data;
            const riskResult = context.results.get('risk-assessment');
            
            this.logger.log(`Making underwriting decision for merchant: ${merchantId}`);

            const decision = this.makeUnderwritingDecision(riskResult);

            // Persist underwriting decision
            await this.prisma.$executeRawUnsafe(
              `INSERT INTO underwritingDecision (id, merchant_id, decision, reason, processing_limits, pricing_tier, underwriting_type, policy_version, rule_trace, reviewed_at, created_at)
               VALUES (
                 gen_random_text(),
                 $1,
                 $2,
                 $3,
                 $4,
                 $5,
                 'automated',
                 '1.0',
                 $6,
                 NOW(),
                 NOW()
               )`,
              merchantId,
              decision.decision,
              decision.reason,
              JSON.stringify(decision.processingLimits),
              decision.pricingTier,
              JSON.stringify(decision.ruleTrace),
            );

            return decision;
          },
          dependsOn: ['risk-assessment'],
        },
        {
          id: 'provisioning',
          name: 'Merchant Provisioning',
          execute: async (context) => {
            const { merchantId } = context.data;
            const underwritingResult = context.results.get('underwriting-decision');
            
            if (underwritingResult.decision !== 'approved') {
              this.logger.log(`Skipping provisioning for unapproved merchant: ${merchantId}`);
              return { skipped: true };
            }

            this.logger.log(`Provisioning merchant: ${merchantId}`);

            // Update merchant status to active
            await this.prisma.$executeRawUnsafe(
              `UPDATE merchants SET status = 'active' WHERE id = $1`,
              merchantId,
            );

            // Create default configuration
            await this.createDefaultConfiguration(merchantId, underwritingResult);

            return { provisionedAt: new Date() };
          },
          dependsOn: ['underwriting-decision'],
        },
        {
          id: 'finalize',
          name: 'Finalize Diligence',
          execute: async (context) => {
            const { merchantId } = context.data;
            const underwritingResult = context.results.get('underwriting-decision');
            
            const status = underwritingResult.decision === 'approved' ? 'active' : 'rejected';
            
            await this.prisma.$executeRawUnsafe(
              `UPDATE merchants SET status = $1 WHERE id = $2`,
              status,
              merchantId,
            );

            return { finalizedAt: new Date(), status };
          },
          dependsOn: ['provisioning'],
        },
      ],
      timeoutMs: 600000, // 10 minutes
      compensationStrategy: 'sequential',
    });

    // Expedited diligence workflow (without bank verification)
    this.workflowEngine.registerWorkflow({
      id: 'diligence-expedited',
      name: 'Expedited Diligence Workflow',
      steps: [
        {
          id: 'initiate-diligence',
          name: 'Initiate Diligence',
          execute: async (context) => {
            const { merchantId } = context.data;
            await this.prisma.$executeRawUnsafe(
              `UPDATE merchants SET status = 'pending_verification' WHERE id = $1`,
              merchantId,
            );
            return { initiatedAt: new Date() };
          },
          compensate: async (context, result) => {
            const { merchantId } = context.data;
            await this.prisma.$executeRawUnsafe(
              `UPDATE merchants SET status = 'draft' WHERE id = $1`,
              merchantId,
            );
          },
        },
        {
          id: 'business-verification',
          name: 'Business Verification',
          execute: async (context) => {
            const { merchantId } = context.data;
            return await this.verificationService.verifyBusiness(merchantId, { country: 'US' });
          },
          parallel: true,
          dependsOn: ['initiate-diligence'],
        },
        {
          id: 'identity-verification',
          name: 'Identity Verification',
          execute: async (context) => {
            const { merchantId, personId } = context.data;
            return await this.verificationService.verifyIdentity(merchantId, personId, { country: 'US' });
          },
          parallel: true,
          dependsOn: ['initiate-diligence'],
        },
        {
          id: 'risk-assessment',
          name: 'Risk Assessment',
          execute: async (context) => {
            const { merchantId } = context.data;
            const businessResult = context.results.get('business-verification');
            const identityResult = context.results.get('identity-verification');

            const riskScore = this.calculateRiskScore({
              business: businessResult,
              identity: identityResult,
            });

            await this.prisma.$executeRawUnsafe(
              `INSERT INTO riskAssessment (id, merchant_id, input_snapshot_hash, risk_score, risk_level, factors, assessment_type, created_at)
               VALUES (gen_random_text(), $1, $2, $3, $4, $5, 'initial', NOW())`,
              merchantId,
              this.generateSnapshotHash(context.data),
              riskScore.score,
              riskScore.level,
              JSON.stringify(riskScore.factors),
            );

            return riskScore;
          },
          dependsOn: ['business-verification', 'identity-verification'],
        },
        {
          id: 'underwriting-decision',
          name: 'Underwriting Decision',
          execute: async (context) => {
            const { merchantId } = context.data;
            const riskResult = context.results.get('risk-assessment');
            const decision = this.makeUnderwritingDecision(riskResult);

            await this.prisma.$executeRawUnsafe(
              `INSERT INTO underwritingDecision (id, merchant_id, decision, reason, processing_limits, pricing_tier, underwriting_type, policy_version, rule_trace, reviewed_at, created_at)
               VALUES (gen_random_text(), $1, $2, $3, $4, $5, 'automated', '1.0', $6, NOW(), NOW())`,
              merchantId,
              decision.decision,
              decision.reason,
              JSON.stringify(decision.processingLimits),
              decision.pricingTier,
              JSON.stringify(decision.ruleTrace),
            );

            return decision;
          },
          dependsOn: ['risk-assessment'],
        },
        {
          id: 'provisioning',
          name: 'Merchant Provisioning',
          execute: async (context) => {
            const { merchantId } = context.data;
            const underwritingResult = context.results.get('underwriting-decision');
            
            if (underwritingResult.decision !== 'approved') {
              return { skipped: true };
            }

            await this.prisma.$executeRawUnsafe(
              `UPDATE merchants SET status = 'active' WHERE id = $1`,
              merchantId,
            );

            await this.createDefaultConfiguration(merchantId, underwritingResult);

            return { provisionedAt: new Date() };
          },
          dependsOn: ['underwriting-decision'],
        },
      ],
      timeoutMs: 300000, // 5 minutes
    });

    this.logger.log('Diligence workflows registered');
  }

  /**
   * Execute full diligence workflow
   */
  async executeFullDiligence(data: {
    merchantId: string;
    personId: string;
    bankAccountId: string;
  }) {
    return this.workflowEngine.execute('diligence-full', data);
  }

  /**
   * Execute expedited diligence workflow
   */
  async executeExpeditedDiligence(data: {
    merchantId: string;
    personId: string;
  }) {
    return this.workflowEngine.execute('diligence-expedited', data);
  }

  /**
   * Calculate risk score from verification results
   */
  private calculateRiskScore(results: any): { score: number; level: string; factors: any } {
    let score = 0;
    const factors: any[] = [];

    // Business verification
    if (results.business?.outcome === 'rejected') {
      score += 50;
      factors.push({ type: 'business_verification', impact: 'high', reason: 'Business verification failed' });
    } else if (results.business?.outcome === 'needs_review') {
      score += 25;
      factors.push({ type: 'business_verification', impact: 'medium', reason: 'Business verification needs review' });
    }

    // Identity verification
    if (results.identity?.outcome === 'rejected') {
      score += 50;
      factors.push({ type: 'identity_verification', impact: 'high', reason: 'Identity verification failed' });
    } else if (results.identity?.outcome === 'needs_review') {
      score += 25;
      factors.push({ type: 'identity_verification', impact: 'medium', reason: 'Identity verification needs review' });
    }

    // Bank verification
    if (results.bank?.outcome === 'rejected') {
      score += 30;
      factors.push({ type: 'bank_verification', impact: 'medium', reason: 'Bank verification failed' });
    }

    // Determine risk level
    let level = 'low';
    if (score >= 70) level = 'high';
    else if (score >= 40) level = 'medium';

    return { score, level, factors };
  }

  /**
   * Make underwriting decision based on risk assessment
   */
  private makeUnderwritingDecision(riskResult: any): any {
    const { score, level } = riskResult;

    if (score >= 70) {
      return {
        decision: 'declined',
        reason: 'High risk score',
        processingLimits: null,
        pricingTier: null,
        ruleTrace: [{ rule: 'high_risk_threshold', result: 'declined', score }],
      };
    }

    if (score >= 40) {
      return {
        decision: 'approved_with_conditions',
        reason: 'Medium risk - additional monitoring required',
        processingLimits: { monthlyVolume: 100000, transactionLimit: 5000 },
        pricingTier: 'standard_plus',
        ruleTrace: [{ rule: 'medium_risk_threshold', result: 'conditional', score }],
      };
    }

    return {
      decision: 'approved',
      reason: 'Low risk - standard approval',
      processingLimits: { monthlyVolume: 500000, transactionLimit: 10000 },
      pricingTier: 'standard',
      ruleTrace: [{ rule: 'low_risk_threshold', result: 'approved', score }],
    };
  }

  /**
   * Generate snapshot hash for input data
   */
  private generateSnapshotHash(data: any): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Create default configuration for approved merchant
   */
  private async createDefaultConfiguration(merchantId: string, underwritingResult: any): Promise<void> {
    // Create product enablement
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO productEnablement (id, merchant_id, product_type, is_enabled, created_at)
       VALUES (gen_random_text(), $1, 'card_payments', true, NOW())`,
      merchantId,
    );

    // Create pricing assignment
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO pricingAssignment (id, merchant_id, pricing_tier, effective_from, created_at)
       VALUES (gen_random_text(), $1, $2, NOW(), NOW())`,
      merchantId,
      underwritingResult.pricingTier,
    );
  }
}
