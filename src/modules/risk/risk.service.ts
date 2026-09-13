import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class RiskService {
  constructor(private prisma: PrismaService) {}

  async assessRisk(merchantId: string, assessmentType: string, factors: string[]) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    // Calculate risk score based on factors
    const riskAssessment = await this.calculateRiskScore(merchant, factors);

    // Save risk assessment to database
    const savedAssessment = await this.prisma.riskAssessment.create({
      data: {
        merchantId,
        riskScore: riskAssessment.score,
        riskLevel: riskAssessment.level,
        factors: riskAssessment.factors,
        recommendations: riskAssessment.recommendations,
        assessmentType,
      },
    });

    return {
      merchant_id: merchantId,
      risk_score: savedAssessment.riskScore,
      risk_level: savedAssessment.riskLevel,
      factors: savedAssessment.factors,
      recommendations: savedAssessment.recommendations,
      assessed_at: savedAssessment.createdAt,
    };
  }

  private async calculateRiskScore(merchant: any, factors: string[]) {
    let totalScore = 0;
    const factorResults: any = {};
    const recommendations: string[] = [];

    // Industry risk assessment
    if (factors.includes('industry_risk')) {
      const industryRisk = this.assessIndustryRisk(merchant);
      factorResults.industry_risk = industryRisk.level;
      totalScore += industryRisk.score;
      if (industryRisk.recommendations) {
        recommendations.push(...industryRisk.recommendations);
      }
    }

    // Geographic risk assessment
    if (factors.includes('geographic_risk')) {
      const geoRisk = this.assessGeographicRisk(merchant);
      factorResults.geographic_risk = geoRisk.level;
      totalScore += geoRisk.score;
      if (geoRisk.recommendations) {
        recommendations.push(...geoRisk.recommendations);
      }
    }

    // Volume risk assessment
    if (factors.includes('volume_risk')) {
      const volumeRisk = this.assessVolumeRisk(merchant);
      factorResults.volume_risk = volumeRisk.level;
      totalScore += volumeRisk.score;
      if (volumeRisk.recommendations) {
        recommendations.push(...volumeRisk.recommendations);
      }
    }

    // Identity risk assessment
    if (factors.includes('identity_risk')) {
      const identityRisk = this.assessIdentityRisk(merchant);
      factorResults.identity_risk = identityRisk.level;
      totalScore += identityRisk.score;
      if (identityRisk.recommendations) {
        recommendations.push(...identityRisk.recommendations);
      }
    }

    // Calculate average score and determine risk level
    const averageScore = Math.round(totalScore / factors.length);
    const riskLevel = this.determineRiskLevel(averageScore);

    return {
      score: averageScore,
      level: riskLevel,
      factors: factorResults,
      recommendations: recommendations.length > 0 ? recommendations : undefined,
    };
  }

  private assessIndustryRisk(merchant: any) {
    const mcc = merchant.businessProfile?.mcc;
    const products = merchant.businessProfile?.products_sold || [];

    // High-risk industries
    const highRiskMCCs = ['7995', '7994', '6012', '4829', '4784'];
    const highRiskProducts = ['gambling', 'adult', 'cryptocurrency', 'tobacco'];

    let score = 20; // Base score for low risk
    let level = 'low';

    if (highRiskMCCs.includes(mcc) || highRiskProducts.some((p) => products.includes(p))) {
      score = 60;
      level = 'high';
    } else if (mcc?.startsWith('5') || products.includes('electronics')) {
      score = 40;
      level = 'medium';
    }

    return {
      score,
      level,
      recommendations: level === 'high' ? ['enhanced_monitoring', 'reduced_limits'] : undefined,
    };
  }

  private assessGeographicRisk(merchant: any) {
    const country = merchant.address?.country;

    // High-risk countries
    const highRiskCountries = ['XX', 'YY']; // Replace with actual high-risk country codes

    let score = 20;
    let level = 'low';

    if (highRiskCountries.includes(country)) {
      score = 70;
      level = 'high';
    } else if (!['US', 'GB', 'CA', 'AU'].includes(country)) {
      score = 40;
      level = 'medium';
    }

    return {
      score,
      level,
      recommendations: level === 'high' ? ['additional_verification', 'geo_blocking'] : undefined,
    };
  }

  private assessVolumeRisk(merchant: any) {
    const volume = merchant.businessProfile?.estimated_monthly_volume || 0;

    let score = 20;
    let level = 'low';

    if (volume > 1000000) {
      score = 50;
      level = 'medium';
    } else if (volume > 5000000) {
      score = 70;
      level = 'high';
    }

    return {
      score,
      level,
      recommendations: level === 'high' ? ['transaction_limits:10000', 'velocity_limits'] : undefined,
    };
  }

  private assessIdentityRisk(merchant: any) {
    // Check if merchant has completed verification
    const hasBusinessVerification = merchant.businessProfile?.tax_id;
    const hasAddress = merchant.address?.line1;

    let score = 20;
    let level = 'low';

    if (!hasBusinessVerification || !hasAddress) {
      score = 50;
      level = 'medium';
    }

    return {
      score,
      level,
      recommendations: level === 'medium' ? ['complete_verification'] : undefined,
    };
  }

  private determineRiskLevel(score: number): string {
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }
}