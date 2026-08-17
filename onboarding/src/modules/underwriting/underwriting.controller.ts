import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UnderwritingDecision } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentAuth } from '../../common/auth/auth-context.decorator';
import { AuthContext } from '../../common/auth/auth.types';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { SubmitUnderwritingDto } from './dto/submit-underwriting.dto';
import { UnderwritingService } from './underwriting.service';

function present(decision: UnderwritingDecision) {
  return {
    id: decision.publicId,
    decision: decision.decision,
    reason: decision.reason,
    reason_codes: decision.reasonCodes,
    processing_limits: decision.processingLimits,
    pricing_tier: decision.pricingTier,
    underwriting_type: decision.underwritingType,
    reviewed_at: decision.reviewedAt.toISOString(),
    expires_at: decision.expiresAt?.toISOString() ?? null,
  };
}

@ApiTags('underwriting')
@Controller()
export class UnderwritingController {
  constructor(
    private readonly underwriting: UnderwritingService,
    private readonly audit: AuditService,
  ) {}

  @Post('underwriting/submit')
  @RequireScopes('underwriting:write')
  @ApiOperation({ summary: 'Submit a merchant for an underwriting decision' })
  async submit(@CurrentAuth() auth: AuthContext, @Body() dto: SubmitUnderwritingDto) {
    const decision = await this.underwriting.submit(auth, dto);
    await this.audit.record(auth, {
      merchantId: decision.merchantId,
      action: 'underwriting.submitted',
      resourceType: 'underwriting_decision',
      resourceId: decision.publicId,
      changes: { decision: decision.decision, reason_codes: decision.reasonCodes },
    });
    return { merchant_id: dto.merchant_id, ...present(decision) };
  }

  @Get('merchants/:merchant_id/underwriting-status')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'Retrieve the latest underwriting decision' })
  async status(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    const decision = await this.underwriting.latest(auth, merchantId);
    return {
      merchant_id: merchantId,
      ...(decision ? present(decision) : { decision: null, reason: 'Not yet submitted' }),
    };
  }
}
