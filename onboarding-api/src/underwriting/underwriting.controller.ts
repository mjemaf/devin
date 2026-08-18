import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthContext, CurrentAuth } from '../auth/auth-context';
import { RequireScopes } from '../auth/decorators';
import { ManualDecisionDto, SubmitUnderwritingDto } from './dto/underwriting.dto';
import { UnderwritingService } from './underwriting.service';

@ApiTags('underwriting')
@Controller('underwriting')
export class UnderwritingController {
  constructor(private readonly underwriting: UnderwritingService) {}

  @Post('submit')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Submit a merchant for an underwriting decision' })
  submit(@CurrentAuth() auth: AuthContext, @Body() dto: SubmitUnderwritingDto) {
    return this.underwriting.submit(
      auth,
      dto.merchant_id,
      dto.underwriting_type ?? 'automated',
      dto.expedited ?? false,
    );
  }

  @Get(':merchantId/status')
  @RequireScopes('read')
  @ApiOperation({ summary: 'Read the latest underwriting decision for a merchant' })
  status(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.underwriting.status(auth, merchantId);
  }

  @Post(':merchantId/manual-decision')
  @RequireScopes('admin')
  @ApiOperation({ summary: 'Record a human underwriting decision after manual review' })
  manualDecision(
    @CurrentAuth() auth: AuthContext,
    @Param('merchantId') merchantId: string,
    @Body() dto: ManualDecisionDto,
  ) {
    const limits =
      dto.daily_limit !== undefined &&
      dto.monthly_limit !== undefined &&
      dto.ticket_size_limit !== undefined
        ? {
            daily_limit: dto.daily_limit,
            monthly_limit: dto.monthly_limit,
            ticket_size_limit: dto.ticket_size_limit,
          }
        : undefined;

    return this.underwriting.recordManualDecision(auth, merchantId, dto.decision, dto.reason, limits);
  }
}
