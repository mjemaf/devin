import { Injectable } from '@nestjs/common';
import {
  AssessmentType,
  Prisma,
  RiskAssessment,
  RiskLevel,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newPublicId } from '../../common/ids';
import { AuthContext } from '../../common/auth/auth.types';
import { MerchantsService } from '../merchants/merchants.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { RiskInput, assessRisk } from './risk-engine';

interface BusinessProfileView {
  mcc: string;
  website: string | null;
  estimated_monthly_volume: number;
}

@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly webhooks: WebhookDispatcherService,
  ) {}

  async assess(
    auth: AuthContext,
    merchantPublicId: string,
    assessmentType: AssessmentType = AssessmentType.onboarding,
  ): Promise<RiskAssessment> {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    const input = await this.buildInput(merchant.id, merchant.country, merchant.businessProfile);
    const result = assessRisk(input);

    const assessment = await this.prisma.riskAssessment.create({
      data: {
        publicId: newPublicId('risk'),
        merchantId: merchant.id,
        riskScore: result.riskScore,
        riskLevel: result.riskLevel,
        factors: result.factors as unknown as Prisma.InputJsonValue,
        recommendations: result.recommendations as unknown as Prisma.InputJsonValue,
        assessmentType,
      },
    });

    if (result.riskLevel === RiskLevel.high || result.riskLevel === RiskLevel.prohibited) {
      await this.webhooks.emit(merchant.partnerId, 'merchant.risk_flagged', {
        merchant_id: merchant.publicId,
        risk_score: result.riskScore,
        risk_level: result.riskLevel,
      });
    }
    return assessment;
  }

  async latest(merchantId: string): Promise<RiskAssessment | null> {
    return this.prisma.riskAssessment.findFirst({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async history(auth: AuthContext, merchantPublicId: string) {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    return this.prisma.riskAssessment.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async buildInput(
    merchantId: string,
    country: string,
    businessProfile: Prisma.JsonValue,
  ): Promise<RiskInput> {
    const profile = businessProfile as unknown as BusinessProfileView;
    const [owners, bankAccounts, documentCount, businessVerification] = await Promise.all([
      this.prisma.owner.findMany({ where: { merchantId } }),
      this.prisma.bankAccount.findMany({ where: { merchantId } }),
      this.prisma.document.count({ where: { merchantId } }),
      this.prisma.verificationAttempt.findFirst({
        where: { merchantId, verificationType: 'business' },
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    return {
      mcc: profile.mcc,
      country,
      estimatedMonthlyVolume: profile.estimated_monthly_volume,
      businessVerified: businessVerification?.status === VerificationStatus.verified,
      ownersVerified:
        owners.length === 0 ||
        owners.every((owner) => owner.verificationStatus === VerificationStatus.verified),
      bankAccountVerified: bankAccounts.some(
        (account) => account.verificationStatus === VerificationStatus.verified,
      ),
      ownerCount: owners.length,
      disclosedOwnershipPercentage: owners.reduce(
        (total, owner) => total + Number(owner.ownershipPercentage),
        0,
      ),
      documentCount,
      websitePresent: Boolean(profile.website),
    };
  }
}
