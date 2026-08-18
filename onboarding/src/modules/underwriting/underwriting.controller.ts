import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../common/auth/current-principal.decorator';
import { Principal } from '../../common/auth/principal';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ReqContext, RequestContext } from '../../common/context/request-context';
import { ManualDecisionDto, SubmitUnderwritingDto } from './dto/underwriting.dto';
import { UnderwritingService } from './underwriting.service';

@ApiTags('underwriting')
@Controller({ version: '1' })
export class UnderwritingController {
  constructor(private readonly underwriting: UnderwritingService) {}

  @Post('underwriting/submit')
  @RequireScopes('underwriting:write')
  @ApiOperation({
    summary: 'Submit a merchant for automated underwriting',
    description: 'Scores the merchant, decides, sets processing limits, and emits a decision event.',
  })
  submit(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: SubmitUnderwritingDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.underwriting.submit(principal, dto, context);
  }

  @Get('merchants/:reference/underwriting-status')
  @RequireScopes('underwriting:read')
  @ApiOperation({ summary: 'Underwriting decision and outstanding blockers' })
  status(@CurrentPrincipal() principal: Principal, @Param('reference') reference: string) {
    return this.underwriting.status(principal, reference);
  }

  @Post('merchants/:reference/underwriting-decision')
  @RequireScopes('underwriting:write')
  @ApiOperation({ summary: 'Record a manual underwriting decision' })
  manual(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: ManualDecisionDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.underwriting.decideManually(
      principal,
      reference,
      { decision: dto.decision, reason: dto.reason, reviewer: dto.reviewer },
      context,
    );
  }
}
