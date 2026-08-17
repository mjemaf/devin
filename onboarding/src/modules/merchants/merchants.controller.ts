import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantStatus } from '@prisma/client';
import { CurrentPrincipal } from '../../common/auth/current-principal.decorator';
import { Principal } from '../../common/auth/principal';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ReqContext, RequestContext } from '../../common/context/request-context';
import { BankAccountsService } from './bank-accounts.service';
import { DocumentsService } from './documents.service';
import { BusinessVerificationDto } from './dto/business-verification.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { CreateOwnersDto } from './dto/create-owners.dto';
import { StatusChangeDto, UpdateMerchantDto } from './dto/update-merchant.dto';
import { UploadDocumentsDto } from './dto/upload-documents.dto';
import { MerchantsService } from './merchants.service';
import { OwnersService } from './owners.service';

@ApiTags('merchants')
@Controller({ path: 'merchants', version: '1' })
export class MerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly owners: OwnersService,
    private readonly bankAccounts: BankAccountsService,
    private readonly documents: DocumentsService,
  ) {}

  @Post()
  @RequireScopes('merchants:write')
  @ApiOperation({
    summary: 'Create a merchant application',
    description:
      'Minimal intake. Returns the merchant id, a merchant-scoped onboarding token for ' +
      'embedded flows, and the country-specific steps still required.',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateMerchantDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.merchants.create(principal, dto, context);
  }

  @Get()
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'List merchants' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query('status') status?: MerchantStatus,
    @Query('country') country?: string,
    @Query('limit') limit = '25',
    @Query('cursor') cursor?: string,
  ) {
    return this.merchants.list(principal, {
      status,
      country,
      limit: Math.min(Number(limit) || 25, 100),
      cursor,
    });
  }

  @Get(':reference')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'Retrieve a merchant profile' })
  get(@CurrentPrincipal() principal: Principal, @Param('reference') reference: string) {
    return this.merchants.get(principal, reference);
  }

  @Patch(':reference')
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Update merchant information' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: UpdateMerchantDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.merchants.update(principal, reference, dto, context);
  }

  @Get(':reference/status')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'Onboarding status and outstanding actions' })
  status(@CurrentPrincipal() principal: Principal, @Param('reference') reference: string) {
    return this.merchants.status(principal, reference);
  }

  @Post(':reference/business-verification')
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Submit business (KYB) information' })
  businessVerification(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: BusinessVerificationDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.merchants.submitBusinessVerification(principal, reference, dto, context);
  }

  @Post(':reference/owners')
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Add beneficial owners' })
  addOwners(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: CreateOwnersDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.owners.add(principal, reference, dto, context);
  }

  @Get(':reference/owners')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'List beneficial owners' })
  listOwners(@CurrentPrincipal() principal: Principal, @Param('reference') reference: string) {
    return this.owners.list(principal, reference);
  }

  @Post(':reference/bank-accounts')
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Add a settlement bank account' })
  addBankAccount(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: CreateBankAccountDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.bankAccounts.add(principal, reference, dto, context);
  }

  @Get(':reference/bank-accounts')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'List settlement bank accounts' })
  listBankAccounts(@CurrentPrincipal() principal: Principal, @Param('reference') reference: string) {
    return this.bankAccounts.list(principal, reference);
  }

  @Post(':reference/documents')
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Upload supporting documents' })
  uploadDocuments(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: UploadDocumentsDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.documents.upload(principal, reference, dto, context);
  }

  @Get(':reference/documents')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'List uploaded documents' })
  listDocuments(@CurrentPrincipal() principal: Principal, @Param('reference') reference: string) {
    return this.documents.list(principal, reference);
  }

  @Post(':reference/onboarding-token')
  @RequireScopes('merchants:write')
  @ApiOperation({
    summary: 'Mint an onboarding session token',
    description:
      'Short-lived, merchant-scoped JWT for embedded UI and white-label flows, so a browser ' +
      'can complete onboarding without a partner API key.',
  })
  async onboardingToken(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
  ) {
    const session = await this.merchants.issueOnboardingToken(principal, reference);
    return {
      merchant_id: reference,
      onboarding_token: session.token,
      expires_in: session.expiresIn,
    };
  }

  @Post(':reference/suspend')
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Suspend a merchant account' })
  suspend(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @Body() dto: StatusChangeDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.merchants.suspend(principal, reference, dto, context);
  }

  @Post(':reference/activate')
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Activate an approved merchant' })
  activate(
    @CurrentPrincipal() principal: Principal,
    @Param('reference') reference: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.merchants.activate(principal, reference, context);
  }
}
