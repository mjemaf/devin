import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto, UpdateDocumentDto } from './dto/document.dto';
import { Scopes } from '../../common/guards/auth.guard';
import { Request } from 'express';

/**
 * Documents Controller
 * 
 * Manages document uploads, validation, and storage
 */
@Controller('v1/applications/:applicationId/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * Upload a document (initiate upload)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // @Scopes('onboarding:write')
  async uploadDocument(
    @Param('applicationId') applicationId: string,
    @Body() dto: UploadDocumentDto,
    @Req() req: any,
  ) {
    const document = await this.documentsService.createDocument(applicationId, dto, req.user.sub);
    
    // Generate presigned upload URL
    const uploadUrl = await this.documentsService.getPresignedUploadUrl(document.id, dto.contentType);

    return {
      data: {
        ...document,
        uploadUrl,
      },
    };
  }

  /**
   * Get document by ID
   */
  @Get(':id')
  // @Scopes('onboarding:read')
  async getDocument(@Param('id') id: string, @Req() req: any) {
    const document = await this.documentsService.getDocument(id, req.user.org_path);
    
    // Generate presigned download URL
    const downloadUrl = await this.documentsService.getPresignedDownloadUrl(id);

    return {
      data: {
        ...document,
        downloadUrl,
      },
    };
  }

  /**
   * List documents for an application
   */
  @Get()
  // @Scopes('onboarding:read')
  async listDocuments(
    @Param('applicationId') applicationId: string,
    @Req() req: any,
  ) {
    const documents = await this.documentsService.listDocuments(applicationId, req.user.org_path);
    return {
      data: documents,
    };
  }

  /**
   * Update document
   */
  @Put(':id')
  // @Scopes('onboarding:write')
  async updateDocument(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @Req() req: any,
  ) {
    const document = await this.documentsService.updateDocument(id, dto, req.user.org_path);
    return {
      data: document,
    };
  }

  /**
   * Delete document
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  // @Scopes('onboarding:write')
  async deleteDocument(@Param('id') id: string, @Req() req: any) {
    await this.documentsService.deleteDocument(id, req.user.org_path);
  }

  /**
   * Validate document
   */
  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  // @Scopes('verification:adjudicate')
  async validateDocument(
    @Param('id') id: string,
    @Body() body: { isValid: boolean; validationErrors?: string[] },
  ) {
    const document = await this.documentsService.validateDocument(id, body.isValid, body.validationErrors);
    return {
      data: document,
    };
  }

  /**
   * Check document expiry
   */
  @Get(':id/expiry')
  // @Scopes('onboarding:read')
  async checkExpiry(@Param('id') id: string) {
    const isExpired = await this.documentsService.checkDocumentExpiry(id);
    return {
      data: {
        isExpired,
      },
    };
  }
}
