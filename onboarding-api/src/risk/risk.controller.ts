import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AuthContext, CurrentAuth } from '../auth/auth-context';
import { RequireScopes } from '../auth/decorators';
import { RiskService } from './risk.service';

export class AssessRiskDto {
  @ApiProperty({ example: 'mer_9f2c1a' })
  @IsString()
  merchant_id!: string;

  @ApiProperty({ enum: ['onboarding', 'ongoing'], required: false })
  @IsOptional()
  @IsIn(['onboarding', 'ongoing'])
  assessment_type?: 'onboarding' | 'ongoing';
}

@ApiTags('risk')
@Controller('risk')
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  @Post('assess')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Score a merchant across industry, geography, volume and identity risk' })
  assess(@CurrentAuth() auth: AuthContext, @Body() dto: AssessRiskDto) {
    return this.risk.assess(auth, dto.merchant_id, dto.assessment_type ?? 'onboarding');
  }

  @Post('reassess')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Re-score an existing merchant as part of ongoing monitoring' })
  reassess(@CurrentAuth() auth: AuthContext, @Body() dto: AssessRiskDto) {
    return this.risk.assess(auth, dto.merchant_id, 'ongoing');
  }

  @Get(':merchantId/history')
  @RequireScopes('read')
  @ApiOperation({ summary: 'List risk assessments recorded for a merchant' })
  history(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.risk.history(auth, merchantId);
  }
}
