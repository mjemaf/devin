import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../common/auth/current-principal.decorator';
import { Principal } from '../../common/auth/principal';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('onboarding')
  @RequireScopes('analytics:read')
  @ApiOperation({ summary: 'Onboarding funnel, approval and drop-off rates' })
  onboarding(@CurrentPrincipal() principal: Principal, @Query('period_days') periodDays = '30') {
    return this.analytics.onboardingFunnel(principal, clampDays(periodDays));
  }

  @Get('risk')
  @RequireScopes('analytics:read')
  @ApiOperation({ summary: 'Risk mix and automated decision share' })
  risk(@CurrentPrincipal() principal: Principal, @Query('period_days') periodDays = '30') {
    return this.analytics.riskMix(principal, clampDays(periodDays));
  }

  @Get('audit-logs')
  @RequireScopes('analytics:read')
  @ApiOperation({ summary: 'Audit trail export' })
  auditLogs(
    @CurrentPrincipal() principal: Principal,
    @Query('merchant_id') merchantId?: string,
    @Query('limit') limit = '100',
  ) {
    return this.analytics.auditTrail(principal, {
      merchantId,
      limit: Math.min(Number(limit) || 100, 500),
    });
  }
}

function clampDays(value: string): number {
  return Math.min(Math.max(Number(value) || 30, 1), 365);
}
