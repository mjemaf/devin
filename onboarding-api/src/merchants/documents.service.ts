import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth-context';
import { ApiException } from '../common/errors/api.exception';
import { sha256 } from '../common/crypto.util';
import { newId } from '../common/ids';
import { MerchantStateService } from './merchant-state.service';
import { UploadDocumentDto } from './dto/document.dto';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Document types that satisfy the business_verification evidence requirement. */
const BUSINESS_DOCUMENT_TYPES = [
  'business_license',
  'articles_of_incorporation',
  'tax_document',
  'bank_statement',
  'proof_of_address',
];

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantState: MerchantStateService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async upload(auth: AuthContext, merchantId: string, dto: UploadDocumentDto) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);

    if (dto.owner_id) {
      const owner = await this.prisma.owner.findFirst({
        where: { id: dto.owner_id, merchantId },
      });
      if (!owner) throw ApiException.notFound('owner', dto.owner_id);
    }

    const content = Buffer.from(dto.file_content, 'base64');
    if (content.length === 0) {
      throw ApiException.validation('document_empty', 'The uploaded document is empty', 'file_content');
    }
    if (content.length > MAX_FILE_BYTES) {
      throw ApiException.validation(
        'document_too_large',
        `Documents must be 10 MB or smaller (received ${content.length} bytes)`,
        'file_content',
      );
    }

    const documentId = newId('document');
    const filePath = await this.persist(merchant.partnerId, merchantId, documentId, content);

    const document = await this.prisma.document.create({
      data: {
        id: documentId,
        merchantId,
        ownerId: dto.owner_id ?? null,
        documentType: dto.document_type,
        filePath,
        fileName: dto.file_name,
        contentType: dto.content_type,
        fileSize: content.length,
        expiresAt: dto.expires_at ? new Date(dto.expires_at) : null,
        metadata: {
          // A checksum lets partners confirm the upload without us echoing content back.
          sha256: sha256(content.toString('base64')),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (BUSINESS_DOCUMENT_TYPES.includes(dto.document_type)) {
      await this.merchantState.advanceStep(merchant, 'business_verification', 'in_progress', [
        'await_document_review',
      ]);
    }

    await this.audit.record(auth, {
      merchantId,
      action: 'merchant.document_uploaded',
      resourceType: 'document',
      resourceId: document.id,
      changes: { document_type: dto.document_type, file_size: content.length },
    });

    return this.serialise(document);
  }

  async list(auth: AuthContext, merchantId: string) {
    await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const documents = await this.prisma.document.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
    return { data: documents.map((document) => this.serialise(document)) };
  }

  /**
   * Sandbox storage writes to a local directory; a production deployment would swap
   * this for a customer-managed-encryption-key GCS bucket.
   */
  private async persist(
    partnerId: string,
    merchantId: string,
    documentId: string,
    content: Buffer,
  ): Promise<string> {
    const root = resolve(this.config.get<string>('documentStorageDir') ?? './.storage');
    const directory = join(root, partnerId, merchantId);
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, documentId);
    await writeFile(filePath, content, { mode: 0o600 });
    return filePath;
  }

  private serialise(document: {
    id: string;
    documentType: string;
    ownerId: string | null;
    fileName: string;
    contentType: string;
    fileSize: number;
    verificationStatus: string;
    expiresAt: Date | null;
    createdAt: Date;
    metadata: Prisma.JsonValue;
  }) {
    return {
      id: document.id,
      object: 'document',
      document_type: document.documentType,
      owner_id: document.ownerId,
      file_name: document.fileName,
      content_type: document.contentType,
      file_size: document.fileSize,
      verification_status: document.verificationStatus,
      expires_at: document.expiresAt,
      checksum: document.metadata,
      created_at: document.createdAt,
    };
  }
}
