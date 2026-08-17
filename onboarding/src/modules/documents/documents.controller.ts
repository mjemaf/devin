import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentAuth } from '../../common/auth/auth-context.decorator';
import { AuthContext } from '../../common/auth/auth.types';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { presentDocument } from '../merchants/merchant.presenter';
import { DocumentsService } from './documents.service';
import { UploadDocumentsDto } from './dto/upload-documents.dto';

@ApiTags('documents')
@Controller('merchants/:merchant_id/documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Upload supporting documents' })
  async upload(
    @CurrentAuth() auth: AuthContext,
    @Param('merchant_id') merchantId: string,
    @Body() dto: UploadDocumentsDto,
  ) {
    const { merchant, documents } = await this.documents.upload(auth, merchantId, dto);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'documents.uploaded',
      resourceType: 'document',
      resourceId: merchant.publicId,
      changes: { types: documents.map((document) => document.documentType) },
    });
    return { data: documents.map(presentDocument) };
  }

  @Get()
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'List uploaded documents' })
  async list(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    const documents = await this.documents.list(auth, merchantId);
    return { data: documents.map(presentDocument) };
  }
}
