import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { MerchantStatus, Prisma, StepStatus } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedRequest, CurrentAuth } from '../../common/auth/auth-context.decorator';
import { AuthContext } from '../../common/auth/auth.types';
import { OnboardingTokenService } from '../../common/auth/onboarding-token.service';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { BusinessVerificationDto } from './dto/business-verification.dto';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { ListMerchantsQueryDto } from './dto/list-merchants.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { presentMerchant, presentStep } from './merchant.presenter';
import { MerchantsService } from './merchants.service';

/** Working-hours estimate the status endpoint reports per outstanding step. */
const HOURS_PER_OUTSTANDING_STEP = 6;

@ApiTags('merchants')
@Controller('merchants')
export class MerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly onboardingTokens: OnboardingTokenService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Create a merchant application' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateMerchantDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const merchant = await this.merchants.create(auth, dto);
    const onboardingToken = await this.onboardingTokens.issue(auth, merchant.publicId);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'merchant.created',
      resourceType: 'merchant',
      resourceId: merchant.publicId,
      changes: { country: merchant.country, business_type: merchant.businessType },
      requestId: request.headers['x-request-id'] as string,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return {
      merchant_id: merchant.publicId,
      status: merchant.status,
      onboarding_token: onboardingToken,
      required_steps: this.merchants.requiredStepNames(merchant.businessType),
      created_at: merchant.createdAt.toISOString(),
    };
  }

  @Get()
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'List merchants boarded by the calling partner' })
  async list(@CurrentAuth() auth: AuthContext, @Query() query: ListMerchantsQueryDto) {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const { data, total } = await this.merchants.list(auth, query.status, limit, offset);
    return {
      data: data.map(presentMerchant),
      total,
      limit,
      offset,
      has_more: offset + data.length < total,
    };
  }

  @Get(':merchant_id')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'Retrieve the full merchant profile' })
  async retrieve(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    return presentMerchant(await this.merchants.findWithRelations(auth, merchantId));
  }

  @Patch(':merchant_id')
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Update merchant contact, address, or profile fields' })
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('merchant_id') merchantId: string,
    @Body() dto: UpdateMerchantDto,
  ) {
    const merchant = await this.merchants.update(auth, merchantId, dto);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'merchant.updated',
      resourceType: 'merchant',
      resourceId: merchant.publicId,
      changes: { ...dto } as Prisma.InputJsonObject,
    });
    return presentMerchant(merchant);
  }

  @Post(':merchant_id/business-verification')
  @HttpCode(200)
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Submit KYB details for the merchant' })
  async submitBusinessDetails(
    @CurrentAuth() auth: AuthContext,
    @Param('merchant_id') merchantId: string,
    @Body() dto: BusinessVerificationDto,
  ) {
    const merchant = await this.merchants.submitBusinessDetails(auth, merchantId, dto);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'merchant.business_details_submitted',
      resourceType: 'merchant',
      resourceId: merchant.publicId,
      changes: { legal_name: dto.legal_name, incorporation_country: dto.incorporation_country },
    });
    return presentMerchant(merchant);
  }

  @Get(':merchant_id/status')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'Check onboarding status and outstanding actions' })
  async status(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    const merchant = await this.merchants.findWithRelations(auth, merchantId);
    const steps = merchant.steps ?? [];
    const outstanding = steps.filter((step) => step.status !== StepStatus.completed).length;
    return {
      merchant_id: merchant.publicId,
      overall_status: merchant.status,
      steps: steps.map(presentStep),
      estimated_completion:
        outstanding === 0
          ? null
          : new Date(
              Date.now() + outstanding * HOURS_PER_OUTSTANDING_STEP * 3_600_000,
            ).toISOString(),
    };
  }

  @Post(':merchant_id/suspend')
  @HttpCode(200)
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Suspend a merchant account' })
  async suspend(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    const merchant = await this.merchants.setStatus(auth, merchantId, MerchantStatus.suspended);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'merchant.suspended',
      resourceType: 'merchant',
      resourceId: merchant.publicId,
    });
    return presentMerchant(merchant);
  }

  @Post(':merchant_id/activate')
  @HttpCode(200)
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Reactivate a suspended merchant' })
  async activate(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    const merchant = await this.merchants.setStatus(auth, merchantId, MerchantStatus.active);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'merchant.activated',
      resourceType: 'merchant',
      resourceId: merchant.publicId,
    });
    return presentMerchant(merchant);
  }
}
