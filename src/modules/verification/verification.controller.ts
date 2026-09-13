import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { Scopes } from '../../common/guards/auth.guard';

/**
 * Verification Controller
 * 
 * Manages verification workflows using the cascade architecture
 */
@Controller('v1/verifications')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  /**
   * Verify business (KYB)
   */
  @Post('business')
  @HttpCode(HttpStatus.ACCEPTED)
  // @Scopes('verification:execute')
  async verifyBusiness(
    @Body() body: {
      merchantId: string;
      sources?: string[];
      priority?: 'low' | 'normal' | 'high';
      country?: string;
    },
    @Req() req: any,
  ) {
    const result = await this.verificationService.verifyBusiness(
      body.merchantId,
      body,
    );
    return {
      data: result,
    };
  }

  /**
   * Verify identity (KYC)
   */
  @Post('identity')
  @HttpCode(HttpStatus.ACCEPTED)
  // @Scopes('verification:execute')
  async verifyIdentity(
    @Body() body: {
      merchantId: string;
      personId: string;
      method?: string;
      consent?: boolean;
      country?: string;
    },
    @Req() req: any,
  ) {
    const result = await this.verificationService.verifyIdentity(
      body.merchantId,
      body.personId,
      body,
    );
    return {
      data: result,
    };
  }

  /**
   * Verify bank account
   */
  @Post('bank-account')
  @HttpCode(HttpStatus.ACCEPTED)
  // @Scopes('verification:execute')
  async verifyBankAccount(
    @Body() body: {
      merchantId: string;
      bankAccountId: string;
      method?: string;
      country?: string;
    },
    @Req() req: any,
  ) {
    const result = await this.verificationService.verifyBankAccount(
      body.merchantId,
      body.bankAccountId,
      body,
    );
    return {
      data: result,
    };
  }

  /**
   * Get verification by ID
   */
  @Get(':id')
  // @Scopes('verification:read')
  async getVerification(@Param('id') id: string) {
    const verification = await this.verificationService.getVerification(id);
    return {
      data: verification,
    };
  }

  /**
   * List verifications for a merchant
   */
  @Get()
  // @Scopes('verification:read')
  async listVerifications(
    @Query('merchantId') merchantId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const verifications = await this.verificationService.listVerifications(merchantId, {
      type,
      limit: limit ? parseInt(limit) : undefined,
      cursor,
    });
    return verifications;
  }
}
