import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthContext, CurrentAuth } from '../auth/auth-context';
import { RequireScopes } from '../auth/decorators';
import {
  ConfirmMicroDepositsDto,
  VerifyBankAccountDto,
  VerifyBusinessDto,
  VerifyIdentityDto,
} from './dto/verification.dto';
import { VerificationService } from './verification.service';

@ApiTags('verification')
@Controller('verify')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post('business')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Run KYB verification against the merchant country registries' })
  business(@CurrentAuth() auth: AuthContext, @Body() dto: VerifyBusinessDto) {
    return this.verification.verifyBusiness(auth, dto.merchant_id, dto.priority === 'expedited');
  }

  @Post('identity')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Run KYC verification for a beneficial owner' })
  identity(@CurrentAuth() auth: AuthContext, @Body() dto: VerifyIdentityDto) {
    return this.verification.verifyIdentity(
      auth,
      dto.merchant_id,
      dto.owner_id,
      dto.verification_method,
      dto.consent,
    );
  }

  @Post('bank-account')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Verify a settlement bank account' })
  bankAccount(@CurrentAuth() auth: AuthContext, @Body() dto: VerifyBankAccountDto) {
    return this.verification.verifyBankAccount(
      auth,
      dto.merchant_id,
      dto.bank_account_id,
      dto.verification_method,
    );
  }

  @Post('bank-account/micro-deposits')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Confirm micro-deposit amounts to finish bank verification' })
  microDeposits(@CurrentAuth() auth: AuthContext, @Body() dto: ConfirmMicroDepositsDto) {
    return this.verification.confirmMicroDeposits(
      auth,
      dto.merchant_id,
      dto.bank_account_id,
      dto.amounts,
    );
  }

  @Get('attempts/:merchantId')
  @RequireScopes('read')
  @ApiOperation({ summary: 'List verification attempts recorded for a merchant' })
  attempts(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.verification.listAttempts(auth, merchantId);
  }
}
