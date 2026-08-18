import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../common/auth/current-principal.decorator';
import { Principal } from '../../common/auth/principal';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ReqContext, RequestContext } from '../../common/context/request-context';
import {
  ConfirmMicroDepositsDto,
  VerifyBankAccountDto,
  VerifyBusinessDto,
  VerifyIdentityDto,
} from './dto/verify.dto';
import { VerificationService } from './verification.service';

@ApiTags('verification')
@Controller({ path: 'verify', version: '1' })
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post('business')
  @RequireScopes('verification:write')
  @ApiOperation({
    summary: 'Run business (KYB) verification',
    description: 'Registry lookup plus sanctions screening against the submitted business details.',
  })
  business(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: VerifyBusinessDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.verification.verifyBusiness(principal, dto, context);
  }

  @Post('identity')
  @RequireScopes('verification:write')
  @ApiOperation({ summary: 'Run identity (KYC) verification for a beneficial owner' })
  identity(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: VerifyIdentityDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.verification.verifyIdentity(principal, dto, context);
  }

  @Post('bank-account')
  @RequireScopes('verification:write')
  @ApiOperation({ summary: 'Verify a bank account instantly or by micro-deposits' })
  bankAccount(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: VerifyBankAccountDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.verification.verifyBankAccount(principal, dto, context);
  }

  @Post('bank-account/confirm')
  @RequireScopes('verification:write')
  @ApiOperation({ summary: 'Confirm micro-deposit amounts' })
  confirm(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: ConfirmMicroDepositsDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.verification.confirmMicroDeposits(principal, dto, context);
  }

  @Get('merchants/:reference')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'Verification history for a merchant' })
  history(@CurrentPrincipal() principal: Principal, @Param('reference') reference: string) {
    return this.verification.listAttempts(principal, reference);
  }
}
