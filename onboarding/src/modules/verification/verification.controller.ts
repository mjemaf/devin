import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { VerificationAttempt } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentAuth } from '../../common/auth/auth-context.decorator';
import { AuthContext } from '../../common/auth/auth.types';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { VerifyBankAccountDto, VerifyBusinessDto, VerifyIdentityDto } from './dto/verify.dto';
import { VerificationService } from './verification.service';

function present(attempt: VerificationAttempt) {
  return {
    id: attempt.publicId,
    verification_type: attempt.verificationType,
    subject_id: attempt.subjectId,
    status: attempt.status,
    provider: attempt.provider,
    result: attempt.responseData,
    error: attempt.errorMessage,
    started_at: attempt.startedAt.toISOString(),
    completed_at: attempt.completedAt?.toISOString() ?? null,
  };
}

@ApiTags('verification')
@Controller()
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly audit: AuditService,
  ) {}

  @Post('verify/business')
  @RequireScopes('verification:write')
  @ApiOperation({ summary: 'Run KYB verification against registries and bureaus' })
  async business(@CurrentAuth() auth: AuthContext, @Body() dto: VerifyBusinessDto) {
    const attempt = await this.verification.verifyBusiness(auth, dto);
    await this.audit.record(auth, {
      merchantId: attempt.merchantId,
      action: 'verification.business',
      resourceType: 'verification_attempt',
      resourceId: attempt.publicId,
      changes: { status: attempt.status },
    });
    return present(attempt);
  }

  @Post('verify/identity')
  @RequireScopes('verification:write')
  @ApiOperation({ summary: 'Run KYC verification for an individual' })
  async identity(@CurrentAuth() auth: AuthContext, @Body() dto: VerifyIdentityDto) {
    const attempt = await this.verification.verifyIdentity(auth, dto);
    await this.audit.record(auth, {
      merchantId: attempt.merchantId,
      action: 'verification.identity',
      resourceType: 'verification_attempt',
      resourceId: attempt.publicId,
      changes: { status: attempt.status, owner_id: dto.owner_id },
    });
    return present(attempt);
  }

  @Post('verify/bank-account')
  @RequireScopes('verification:write')
  @ApiOperation({ summary: 'Validate a settlement bank account' })
  async bankAccount(@CurrentAuth() auth: AuthContext, @Body() dto: VerifyBankAccountDto) {
    const attempt = await this.verification.verifyBankAccount(auth, dto);
    await this.audit.record(auth, {
      merchantId: attempt.merchantId,
      action: 'verification.bank_account',
      resourceType: 'verification_attempt',
      resourceId: attempt.publicId,
      changes: { status: attempt.status, bank_account_id: dto.bank_account_id },
    });
    return present(attempt);
  }

  @Get('merchants/:merchant_id/verification-attempts')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'List verification attempts for a merchant' })
  async attempts(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    const attempts = await this.verification.attempts(auth, merchantId);
    return { data: attempts.map(present) };
  }
}
