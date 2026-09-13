import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UploadDocumentDto, UpdateDocumentDto, DocumentStatus } from './dto/document.dto';
import { Prisma } from '@prisma/client';

/**
 * Documents Service
 * 
 * Manages document uploads, validation, and storage
 */
@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a document record (initiate upload)
   */
  async createDocument(applicationId: string, dto: UploadDocumentDto, userId: string) {
    const documentId = await this.prisma.$executeRawUnsafe(
      `INSERT INTO documents (id, application_id, document_type, document_name, description, content_type, file_size, status, uploaded_by, created_at, updated_at)
       VALUES (
         gen_random_text(),
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         'uploading',
         $7,
         NOW(),
         NOW()
       )
       RETURNING id`,
      applicationId,
      dto.documentType,
      dto.documentName || null,
      dto.description || null,
      dto.contentType || null,
      dto.fileSize || null,
      userId,
    );

    const document = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM documents WHERE id = $1`,
      documentId,
    ) as any[];

    return document[0];
  }

  /**
   * Get document by ID
   */
  async getDocument(id: string, orgPath: string) {
    const document = await this.prisma.$queryRawUnsafe(
      `SELECT d.*, o.path as org_path
       FROM documents d
       JOIN applications a ON d.application_id = a.id
       JOIN organizations o ON a.organization_id = o.id
       WHERE d.id = $1 AND o.path = $2
       LIMIT 1`,
      id,
      orgPath,
    ) as any[];

    if (!document || document.length === 0) {
      throw new NotFoundException('Document not found');
    }

    return document[0];
  }

  /**
   * Update document
   */
  async updateDocument(id: string, dto: UpdateDocumentDto, orgPath: string) {
    const existing = await this.getDocument(id, orgPath);

    const updateFields: string[] = [];
    const values: any[] = [];

    if (dto.documentName) {
      updateFields.push('document_name = $2');
      values.push(dto.documentName);
    }
    if (dto.description) {
      updateFields.push('description = $3');
      values.push(dto.description);
    }
    if (dto.status) {
      updateFields.push('status = $4');
      values.push(dto.status);
    }
    if (dto.rejectionReason) {
      updateFields.push('rejection_reason = $5');
      values.push(dto.rejectionReason);
    }
    if (dto.expiresAt) {
      updateFields.push('expires_at = $6');
      values.push(dto.expiresAt);
    }

    if (updateFields.length === 0) {
      return existing;
    }

    updateFields.push('updated_at = NOW()');
    values.push(id);

    await this.prisma.$executeRawUnsafe(
      `UPDATE documents
       SET ${updateFields.join(', ')}
       WHERE id = $${values.length}`,
      ...values,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM documents WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Delete document
   */
  async deleteDocument(id: string, orgPath: string) {
    const document = await this.getDocument(id, orgPath);

    // Only allow deletion of documents in uploading or rejected status
    if (document.status !== DocumentStatus.UPLOADING && document.status !== DocumentStatus.REJECTED) {
      throw new ForbiddenException('Cannot delete document in current status');
    }

    await this.prisma.$executeRawUnsafe(
      `DELETE FROM documents WHERE id = $1`,
      id,
    );
  }

  /**
   * List documents for an application
   */
  async listDocuments(applicationId: string, orgPath: string) {
    const result = await this.prisma.$queryRawUnsafe(
      `SELECT d.*
       FROM documents d
       JOIN applications a ON d.application_id = a.id
       JOIN organizations o ON a.organization_id = o.id
       WHERE d.application_id = $1 AND o.path = $2
       ORDER BY d.created_at DESC`,
      applicationId,
      orgPath,
    );
    return result as any[];
  }

  /**
   * Mark document as uploaded
   */
  async markUploaded(id: string, storageUrl: string, storageKey: string) {
    await this.prisma.$executeRawUnsafe(
      `UPDATE documents
       SET 
         status = 'pending',
         storage_url = $2,
         storage_key = $3,
         uploaded_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      id,
      storageUrl,
      storageKey,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM documents WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Validate document
   */
  async validateDocument(id: string, isValid: boolean, validationErrors?: string[]) {
    const status = isValid ? DocumentStatus.APPROVED : DocumentStatus.REJECTED;
    const rejectionReason = isValid ? null : validationErrors?.join(', ');

    await this.prisma.$executeRawUnsafe(
      `UPDATE documents
       SET 
         status = $2,
         rejection_reason = $3,
         validated_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      id,
      status,
      rejectionReason,
    );

    const updated = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM documents WHERE id = $1`,
      id,
    ) as any[];

    return updated[0];
  }

  /**
   * Check if document is expired
   */
  async checkDocumentExpiry(id: string): Promise<boolean> {
    const document = await this.prisma.$queryRawUnsafe(
      `SELECT expires_at FROM documents WHERE id = $1 LIMIT 1`,
      id,
    ) as any[];

    if (!document || document.length === 0) {
      return false;
    }

    if (document[0].expires_at && new Date(document[0].expires_at) < new Date()) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE documents SET status = 'expired' WHERE id = $1`,
        id,
      );
      return true;
    }

    return false;
  }

  /**
   * Get presigned upload URL (placeholder for cloud storage integration)
   */
  async getPresignedUploadUrl(documentId: string, contentType: string): Promise<string> {
    // This would integrate with cloud storage (GCS, S3, etc.)
    // For now, return a placeholder
    return `https://storage.example.com/upload/${documentId}`;
  }

  /**
   * Get presigned download URL (placeholder for cloud storage integration)
   */
  async getPresignedDownloadUrl(documentId: string): Promise<string> {
    // This would integrate with cloud storage (GCS, S3, etc.)
    // For now, return a placeholder
    return `https://storage.example.com/download/${documentId}`;
  }
}
