import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../common/auth/current-principal.decorator';
import { Principal } from '../../common/auth/principal';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ReqContext, RequestContext } from '../../common/context/request-context';
import { AssessRiskDto } from './dto/risk.dto';
import { RiskService } from './risk.service';

@ApiTags('risk')
@Controller({ path: 'risk', version: '1' })
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  @Post('assess')
  @RequireScopes('risk:write')
  @ApiOperation({
    summary: 'Score a merchant',
    description: 'Weighted model over category, geography, volume, tenure, verification and screening.',
  })
  assess(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: AssessRiskDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.risk.assess(principal, dto.merchant_id, dto.assessment_type ?? 'onboarding', context);
  }

  @Post('reassess')
  @RequireScopes('risk:write')
  @ApiOperation({ summary: 'Re-score an existing merchant (ongoing monitoring)' })
  reassess(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: AssessRiskDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.risk.assess(principal, dto.merchant_id, dto.assessment_type ?? 'ongoing', context);
  }

  @Get('merchants/:reference')
  @RequireScopes('risk:read')
  @ApiOperation({ summary: 'Latest risk assessment for a merchant' })
  latest(@CurrentPrincipal() principal: Principal, @Param('reference') reference: string) {
    return this.risk.latest(principal, reference);
  }
}
