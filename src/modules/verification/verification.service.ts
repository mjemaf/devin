import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { VerificationCascadeService, ReconciliationStrategy } from './verification-cascade.service';
import { VerificationRequest, VerificationResponse, VerificationOutcome, FindingType } from './types/verification.types';
import { CascadeConfig } from './verification-cascade.service';

/**
 * Verification Service
 * 
 * Orchestrates verification workflows using the cascade architecture
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private prisma: PrismaService,
    private cascadeService: VerificationCascadeService,
  ) {}

  /**
   * Verify business (KYB)
   */
  async verifyBusiness(merchantId: string, options: {
    sources?: string[];
    priority?: 'low' | 'normal' | 'high';
    country?: string;
  }) {
    const merchant = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM merchants WHERE id = $1 LIMIT 1`,
      merchantId,
    ) as any[];

    if (!merchant || merchant.length === 0) {
      throw new NotFoundException('Merchant not found');
    }

    const request: VerificationRequest = {
      type: 'kyb',
      data: {
        merchantId,
        businessName: merchant[0].business_profile?.name,
        taxId: merchant[0].business_profile?.tax_id,
        address: merchant[0].address,
        country: options.country || 'US',
      },
      options: {
        priority: options.priority || 'normal',
      },
    };

    const config: CascadeConfig = {
      type: 'kyb',
      country: options.country || 'US',
      strategy: ReconciliationStrategy.BEST_CONFIDENCE,
      providers: [
        { name: 'provider1', type: 'kyb', priority: 1, enabled: true },
        { name: 'provider2', type: 'kyb', priority: 2, enabled: true },
      ],
      cacheTtl: 300000, // 5 minutes
    };

    const response = await this.cascadeService.executeVerification(request, config);

    // Persist verification attempt
    const verificationId = await this.prisma.$executeRawUnsafe(
      `INSERT INTO verification_attempt (id, merchant_id, type, status, provider, findings, request_data, response_data, started_at, completed_at)
       VALUES (
         gen_random_text(),
         $1,
         'kyb',
         $2,
         $3,
         $4,
         $5,
         $6,
         NOW(),
         NOW()
       )
       RETURNING id`,
      merchantId,
      response.outcome === 'error' ? 'failed' : 'completed',
      response.provider,
      JSON.stringify(response.findings),
      JSON.stringify(request.data),
      JSON.stringify(response),
    );

    const verification = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM verification_attempt WHERE id = $1`,
      verificationId,
    ) as any[];

    return {
      verificationId: verification[0].id,
      merchantId,
      type: 'kyb',
      outcome: response.outcome,
      findings: response.findings,
      latencyMs: response.latencyMs,
      cost: response.cost,
    };
  }

  /**
   * Verify identity (KYC)
   */
  async verifyIdentity(merchantId: string, personId: string, options: {
    method?: string;
    consent?: boolean;
    country?: string;
  }) {
    const person = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM owner WHERE id = $1 AND merchant_id = $2 LIMIT 1`,
      personId,
      merchantId,
    ) as any[];

    if (!person || person.length === 0) {
      throw new NotFoundException('Person not found');
    }

    const request: VerificationRequest = {
      type: 'kyc',
      data: {
        personId,
        firstName: person[0].first_name,
        lastName: person[0].last_name,
        dateOfBirth: person[0].date_of_birth,
        address: person[0].address,
        country: options.country || 'US',
      },
      options: {
        priority: 'normal',
      },
    };

    const config: CascadeConfig = {
      type: 'kyc',
      country: options.country || 'US',
      strategy: ReconciliationStrategy.CONSENSUSUS,
      providers: [
        { name: 'provider1', type: 'kyc', priority: 1, enabled: true },
        { name: 'provider2', type: 'kyc', priority: 2, enabled: true },
      ],
      cacheTtl: 600000, // 10 minutes
    };

    const response = await this.cascadeService.executeVerification(request, config);

    // Update person verification status
    await this.prisma.$executeRawUnsafe(
      `UPDATE owner
       SET verification_status = $2
       WHERE id = $1`,
      personId,
      response.outcome === 'clear' ? 'verified' : 'failed',
    );

    // Persist verification attempt
    const verificationId = await this.prisma.$executeRawUnsafe(
      `INSERT INTO verification_attempt (id, merchant_id, type, status, provider, findings, request_data, response_data, started_at, completed_at)
       VALUES (
         gen_random_text(),
         $1,
         'kyc',
         $2,
         $3,
         $4,
         $5,
         $6,
         NOW(),
         NOW()
       )
       RETURNING id`,
      merchantId,
      response.outcome === 'error' ? 'failed' : 'completed',
      response.provider,
      JSON.stringify(response.findings),
      JSON.stringify(request.data),
      JSON.stringify(response),
    );

    const verification = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM verification_attempt WHERE id = $1`,
      verificationId,
    ) as any[];

    return {
      verificationId: verification[0].id,
      merchantId,
      personId,
      type: 'kyc',
      outcome: response.outcome,
      findings: response.findings,
      latencyMs: response.latencyMs,
      cost: response.cost,
    };
  }

  /**
   * Verify bank account
   */
  async verifyBankAccount(merchantId: string, bankAccountId: string, options: {
    method?: string;
    country?: string;
  }) {
    const bankAccount = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM bankAccount WHERE id = $1 AND merchant_id = $2 LIMIT 1`,
      bankAccountId,
      merchantId,
    ) as any[];

    if (!bankAccount || bankAccount.length === 0) {
      throw new NotFoundException('Bank account not found');
    }

    const request: VerificationRequest = {
      type: 'bank',
      data: {
        bankAccountId,
        routingNumber: bankAccount[0].routing_number,
        accountNumberLast4: bankAccount[0].account_number_last4,
        accountHolderName: bankAccount[0].account_holder_name,
        country: options.country || 'US',
      },
      options: {
        priority: 'normal',
      },
    };

    const config: CascadeConfig = {
      type: 'bank',
      country: options.country || 'US',
      strategy: ReconciliationStrategy.ALL_MUST_PASS,
      providers: [
        { name: 'provider1', type: 'bank', priority: 1, enabled: true },
      ],
      cacheTtl: 180000, // 3 minutes
    };

    const response = await this.cascadeService.executeVerification(request, config);

    // Update bank account verification status
    await this.prisma.$executeRawUnsafe(
      `UPDATE bankAccount
       SET verification_status = $2
       WHERE id = $1`,
      bankAccountId,
      response.outcome === 'clear' ? 'verified' : 'failed',
    );

    // Persist verification attempt
    const verificationId = await this.prisma.$executeRawUnsafe(
      `INSERT INTO verification_attempt (id, merchant_id, bank_account_id, type, status, provider, findings, request_data, response_data, started_at, completed_at)
       VALUES (
         gen_random_text(),
         $1,
         $2,
         'bank',
         $3,
         $4,
         $5,
         $6,
         $7,
         NOW(),
         NOW()
       )
       RETURNING id`,
      merchantId,
      bankAccountId,
      response.outcome === 'error' ? 'failed' : 'completed',
      response.provider,
      JSON.stringify(response.findings),
      JSON.stringify(request.data),
      JSON.stringify(response),
    );

    const verification = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM verification_attempt WHERE id = $1`,
      verificationId,
    ) as any[];

    return {
      verificationId: verification[0].id,
      merchantId,
      bankAccountId,
      type: 'bank',
      outcome: response.outcome,
      findings: response.findings,
      latencyMs: response.latencyMs,
      cost: response.cost,
    };
  }

  /**
   * Get verification by ID
   */
  async getVerification(verificationId: string) {
    const verification = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM verification_attempt WHERE id = $1 LIMIT 1`,
      verificationId,
    ) as any[];

    if (!verification || verification.length === 0) {
      throw new NotFoundException('Verification not found');
    }

    return verification[0];
  }

  /**
   * List verifications for a merchant
   */
  async listVerifications(merchantId: string, options: {
    type?: string;
    limit?: number;
    cursor?: string;
  }) {
    const limit = options.limit || 50;
    let query = `
      SELECT * FROM verification_attempt
      WHERE merchant_id = $1
    `;
    const params: any[] = [merchantId];

    if (options.type) {
      query += ` AND type = $${params.length + 1}`;
      params.push(options.type);
    }

    if (options.cursor) {
      query += ` AND id > $${params.length + 1}`;
      params.push(options.cursor);
    }

    query += ` ORDER BY started_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const verifications = await this.prisma.$queryRawUnsafe(query, ...params) as any[];

    return {
      data: verifications,
      cursor: verifications.length > 0 ? verifications[verifications.length - 1].id : null,
      hasMore: verifications.length === limit,
    };
  }
}
