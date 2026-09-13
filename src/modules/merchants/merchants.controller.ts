import { Controller, Post, Get, Body, Param, Headers, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { MerchantsService } from './merchants.service';
import { CreateMerchantDto } from '../../common/dto/create-merchant.dto';
import { BusinessVerificationDto } from '../../common/dto/business-verification.dto';
import { CreateBankAccountDto } from '../../common/dto/bank-account.dto';

@ApiTags('merchants')
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new merchant application' })
  @ApiResponse({ status: 201, description: 'Merchant created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async createMerchant(
    @Body() createMerchantDto: CreateMerchantDto,
    @Headers('x-partner-id') partnerId: string,
  ) {
    if (!partnerId) {
      throw new Error('X-Partner-ID header is required');
    }
    return this.merchantsService.createMerchant(createMerchantDto, partnerId);
  }

  @Get(':merchantId')
  @ApiOperation({ summary: 'Get merchant profile' })
  @ApiResponse({ status: 200, description: 'Merchant profile retrieved' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async getMerchant(
    @Param('merchantId') merchantId: string,
    @Headers('x-partner-id') partnerId: string,
  ) {
    return this.merchantsService.getMerchant(merchantId, partnerId);
  }

  @Post(':merchantId/business-verification')
  @ApiOperation({ summary: 'Submit business verification' })
  @ApiResponse({ status: 200, description: 'Business verification submitted' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async submitBusinessVerification(
    @Param('merchantId') merchantId: string,
    @Body() businessVerificationDto: BusinessVerificationDto,
    @Headers('x-partner-id') partnerId: string,
  ) {
    return this.merchantsService.submitBusinessVerification(
      merchantId,
      businessVerificationDto,
      partnerId,
    );
  }

  @Post(':merchantId/bank-accounts')
  @ApiOperation({ summary: 'Add bank account' })
  @ApiResponse({ status: 201, description: 'Bank account added' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async addBankAccount(
    @Param('merchantId') merchantId: string,
    @Body() createBankAccountDto: CreateBankAccountDto,
    @Headers('x-partner-id') partnerId: string,
  ) {
    return this.merchantsService.addBankAccount(merchantId, createBankAccountDto, partnerId);
  }

  @Get(':merchantId/status')
  @ApiOperation({ summary: 'Get merchant onboarding status' })
  @ApiResponse({ status: 200, description: 'Status retrieved' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  @ApiHeader({ name: 'X-API-Key', description: 'API Key for authentication' })
  async getMerchantStatus(
    @Param('merchantId') merchantId: string,
    @Headers('x-partner-id') partnerId: string,
  ) {
    return this.merchantsService.getMerchantStatus(merchantId, partnerId);
  }
}