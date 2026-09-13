import { Controller, Post, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { RiskService } from './risk.service';

@ApiTags('risk')
@Controller('risk')
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Post('assess')
  @ApiOperation({ summary: 'Trigger comprehensive risk assessment' })
  @ApiResponse({ status: 200, description: 'Risk assessment completed' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async assessRisk(
    @Body() body: {
      merchant_id: string;
      assessment_type: string;
      factors: string[];
    },
  ) {
    return this.riskService.assessRisk(body.merchant_id, body.assessment_type, body.factors);
  }
}