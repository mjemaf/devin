import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AssessmentType, RiskAssessment } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentAuth } from '../../common/auth/auth-context.decorator';
import { AuthContext } from '../../common/auth/auth.types';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { AssessRiskDto } from './dto/assess-risk.dto';
import { RiskService } from './risk.service';

type FactorMap = Record<string, unknown>;

function present(assessment: RiskAssessment, requestedFactors?: string[]) {
  const factors = assessment.factors as FactorMap;
  return {
    id: assessment.publicId,
    risk_score: assessment.riskScore,
    risk_level: assessment.riskLevel,
    factors: requestedFactors
      ? Object.fromEntries(
          Object.entries(factors).filter(([factor]) => requestedFactors.includes(factor)),
        )
      : factors,
    recommendations: assessment.recommendations,
    assessment_type: assessment.assessmentType,
    assessed_at: assessment.createdAt.toISOString(),
  };
}

@ApiTags('risk')
@Controller()
export class RiskController {
  constructor(
    private readonly risk: RiskService,
    private readonly audit: AuditService,
  ) {}

  @Post('risk/assess')
  @RequireScopes('risk:write')
  @ApiOperation({ summary: 'Score a merchant with the explainable risk model' })
  async assess(@CurrentAuth() auth: AuthContext, @Body() dto: AssessRiskDto) {
    const assessment = await this.risk.assess(
      auth,
      dto.merchant_id,
      dto.assessment_type ?? AssessmentType.onboarding,
    );
    await this.audit.record(auth, {
      merchantId: assessment.merchantId,
      action: 'risk.assessed',
      resourceType: 'risk_assessment',
      resourceId: assessment.publicId,
      changes: { risk_score: assessment.riskScore, risk_level: assessment.riskLevel },
    });
    return { merchant_id: dto.merchant_id, ...present(assessment, dto.factors) };
  }

  @Post('risk/reassess')
  @RequireScopes('risk:write')
  @ApiOperation({ summary: 'Re-score an active merchant (ongoing monitoring)' })
  async reassess(@CurrentAuth() auth: AuthContext, @Body() dto: AssessRiskDto) {
    const assessment = await this.risk.assess(auth, dto.merchant_id, AssessmentType.ongoing);
    await this.audit.record(auth, {
      merchantId: assessment.merchantId,
      action: 'risk.reassessed',
      resourceType: 'risk_assessment',
      resourceId: assessment.publicId,
      changes: { risk_score: assessment.riskScore, risk_level: assessment.riskLevel },
    });
    return { merchant_id: dto.merchant_id, ...present(assessment, dto.factors) };
  }

  @Get('merchants/:merchant_id/risk-assessments')
  @RequireScopes('risk:read')
  @ApiOperation({ summary: 'List risk assessments for a merchant' })
  async history(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    const assessments = await this.risk.history(auth, merchantId);
    return { data: assessments.map((assessment) => present(assessment)) };
  }
}
