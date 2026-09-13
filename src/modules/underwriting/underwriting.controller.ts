import { Controller, Post, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { UnderwritingService } from './underwriting.service';

@ApiTags('underwriting')
@Controller('underwriting')
export class UnderwritingController {
  constructor(private readonly underwritingService: UnderwritingService) {}

  @Post('submit')
  @ApiOperation({ summary: 'Submit merchant for underwriting decision' })
  @ApiResponse({ status: 200, description: 'Underwriting decision completed' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async submitUnderwriting(
    @Body() body: {
      merchant_id: string;
      underwriting_type: string;
      expedited: boolean;
    },
  ) {
    return this.underwritingService.submitUnderwriting(
      body.merchant_id,
      body.underwriting_type,
      body.expedited,
    );
  }
}