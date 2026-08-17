import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MerchantStatus } from '@prisma/client';
import { AuthContext, CurrentAuth } from '../auth/auth-context';
import { RequireScopes } from '../auth/decorators';
import { CreateBankAccountDto } from './dto/bank-account.dto';
import { SubmitBusinessVerificationDto } from './dto/business-verification.dto';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { UploadDocumentDto } from './dto/document.dto';
import { CreateOwnerDto } from './dto/owner.dto';
import { SuspendMerchantDto, UpdateMerchantDto } from './dto/update-merchant.dto';
import { DocumentsService } from './documents.service';
import { MerchantsService } from './merchants.service';

@ApiTags('merchants')
@ApiHeader({
  name: 'Idempotency-Key',
  required: false,
  description: 'Safely retry mutating requests without creating duplicates',
})
@Controller('merchants')
export class MerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly documents: DocumentsService,
  ) {}

  @Post()
  @RequireScopes('write')
  @ApiOperation({ summary: 'Create a merchant with the minimum viable application' })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateMerchantDto) {
    return this.merchants.create(auth, dto);
  }

  @Get()
  @RequireScopes('read')
  @ApiQuery({ name: 'status', required: false, enum: MerchantStatus })
  @ApiQuery({ name: 'limit', required: false, example: 25 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOperation({ summary: 'List the merchants owned by the calling partner' })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query('status') status?: MerchantStatus,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.merchants.list(auth, status, limit ? parseInt(limit, 10) : undefined, cursor);
  }

  @Get(':merchantId')
  @RequireScopes('read')
  get(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.merchants.get(auth, merchantId);
  }

  @Patch(':merchantId')
  @RequireScopes('write')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('merchantId') merchantId: string,
    @Body() dto: UpdateMerchantDto,
  ) {
    return this.merchants.update(auth, merchantId, dto);
  }

  @Post(':merchantId/business-verification')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Submit KYB information and run business verification' })
  submitBusinessVerification(
    @CurrentAuth() auth: AuthContext,
    @Param('merchantId') merchantId: string,
    @Body() dto: SubmitBusinessVerificationDto,
  ) {
    return this.merchants.submitBusinessVerification(auth, merchantId, dto);
  }

  @Post(':merchantId/owners')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Add a beneficial owner or control person' })
  addOwner(
    @CurrentAuth() auth: AuthContext,
    @Param('merchantId') merchantId: string,
    @Body() dto: CreateOwnerDto,
  ) {
    return this.merchants.addOwner(auth, merchantId, dto);
  }

  @Get(':merchantId/owners')
  @RequireScopes('read')
  listOwners(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.merchants.listOwners(auth, merchantId);
  }

  @Post(':merchantId/bank-accounts')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Attach a settlement bank account and start verification' })
  addBankAccount(
    @CurrentAuth() auth: AuthContext,
    @Param('merchantId') merchantId: string,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.merchants.addBankAccount(auth, merchantId, dto);
  }

  @Get(':merchantId/bank-accounts')
  @RequireScopes('read')
  listBankAccounts(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.merchants.listBankAccounts(auth, merchantId);
  }

  @Post(':merchantId/documents')
  @RequireScopes('write')
  @ApiOperation({ summary: 'Upload a supporting document (base64 encoded)' })
  uploadDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('merchantId') merchantId: string,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.documents.upload(auth, merchantId, dto);
  }

  @Get(':merchantId/documents')
  @RequireScopes('read')
  listDocuments(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.documents.list(auth, merchantId);
  }

  @Get(':merchantId/status')
  @RequireScopes('read')
  @ApiOperation({ summary: 'Read onboarding progress, risk and underwriting state' })
  status(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.merchants.status(auth, merchantId);
  }

  @Post(':merchantId/suspend')
  @RequireScopes('admin')
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('merchantId') merchantId: string,
    @Body() dto: SuspendMerchantDto,
  ) {
    return this.merchants.suspend(auth, merchantId, dto.reason);
  }

  @Post(':merchantId/activate')
  @RequireScopes('admin')
  activate(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.merchants.activate(auth, merchantId);
  }

  @Get(':merchantId/audit-logs')
  @RequireScopes('admin')
  auditLogs(@CurrentAuth() auth: AuthContext, @Param('merchantId') merchantId: string) {
    return this.merchants.auditTrail(auth, merchantId);
  }
}
