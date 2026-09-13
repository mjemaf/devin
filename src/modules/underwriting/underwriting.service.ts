import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UnderwritingService {
  constructor(private prisma: PrismaService) {}

  async submitUnderwriting(
    merchantId: string,
    underwritingType: string,
    expedited: boolean,
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        riskAssessments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    // Get latest risk assessment
    const latestRiskAssessment = merchant.riskAssessments[0];
    const riskScore = latestRiskAssessment?.riskScore || 50;
    const riskLevel = latestRiskAssessment?.riskLevel || 'medium';

    // Make underwriting decision based on risk assessment
    const decision = this.makeUnderwritingDecision(riskScore, riskLevel, underwritingType);

    // Calculate processing limits based on decision
    const processingLimits = this.calculateProcessingLimits(decision, riskLevel);

    // Save underwriting decision
    const savedDecision = await this.prisma.underwritingDecision.create({
      data: {
        merchantId,
        decision: decision.decision,
        reason: decision.reason,
        processingLimits,
        pricingTier: decision.pricingTier,
        underwritingType,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Update merchant status if approved
    if (decision.decision === 'approved') {
      await this.prisma.merchant.update({
        where: { id: merchantId },
        data: {
          status: 'approved',
          processingLimits,
        },
      });
    } else if (decision.decision === 'declined') {
      await this.prisma.merchant.update({
        where: { id: merchantId },
        data: {
          status: 'declined',
        },
      });
    }

    return {
      merchant_id: merchantId,
      decision: savedDecision.decision,
      reason: savedDecision.reason,
      processing_limits: savedDecision.processingLimits,
      pricing_tier: savedDecision.pricingTier,
      reserved_until: savedDecision.expiresAt,
    };
  }

  private makeUnderwritingDecision(riskScore: number, riskLevel: string, underwritingType: string) {
    // Automated underwriting logic
    if (underwritingType === 'automated') {
      if (riskScore < 40 && riskLevel === 'low') {
        return {
          decision: 'approved',
          reason: 'Low risk profile with strong verification',
          pricingTier: 'standard',
        };
      } else if (riskScore < 60 && riskLevel === 'medium') {
        return {
          decision: 'approved',
          reason: 'Acceptable risk profile with standard verification',
          pricingTier: 'standard',
        };
      } else if (riskScore >= 60 || riskLevel === 'high') {
        return {
          decision: 'manual_review',
          reason: 'High risk profile requires manual review',
          pricingTier: null,
        };
      }
    }

    // Manual underwriting always goes to manual review
    return {
      decision: 'manual_review',
      reason: 'Manual underwriting requested',
      pricingTier: null,
    };
  }

  private calculateProcessingLimits(decision: any, riskLevel: string) {
    if (decision.decision !== 'approved') {
      return null;
    }

    const baseLimits = {
      daily_limit: 50000,
      monthly_limit: 500000,
      ticket_size_limit: 10000,
    };

    // Adjust limits based on risk level
    if (riskLevel === 'medium') {
      return {
        daily_limit: 25000,
        monthly_limit: 250000,
        ticket_size_limit: 5000,
      };
    } else if (riskLevel === 'high') {
      return {
        daily_limit: 10000,
        monthly_limit: 100000,
        ticket_size_limit: 2500,
      };
    }

    return baseLimits;
  }
}