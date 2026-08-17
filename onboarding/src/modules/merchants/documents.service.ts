import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { sha256 } from '../../common/util/crypto';
import { newReference } from '../../common/util/references';
import { ComplianceService } from '../compliance/compliance.service';
import { UploadDocumentsDto } from './dto/upload-documents.dto';
import { MerchantStateService } from './merchant-state.service';
import { serializeDocument } from './merchant.serializer';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MerchantStateService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async upload(
    principal: Principal,
    reference: string,
    dto: UploadDocumentsDto,
    context: RequestContext,
  ) {
    const merchant = await this.state.require(principal, reference);
    const maxBytes = this.config.getOrThrow<number>('maxDocumentBytes');
    const baseDir = this.config.getOrThrow<string>('documentStorageDir');
    const merchantDir = join(baseDir, merchant.reference);
    await mkdir(merchantDir, { recursive: true });

    const created = [];
    for (const document of dto.documents) {
      const contents = Buffer.from(document.file, 'base64');
      if (contents.byteLength === 0) {
        throw ApiException.validation('empty_document', 'Document contents are empty.', 'file');
      }
      if (contents.byteLength > maxBytes) {
        throw ApiException.validation(
          'document_too_large',
          `Documents must be ${maxBytes} bytes or smaller.`,
          'file',
        );
      }

      const owner = document.owner_id
        ? await this.prisma.owner.findFirst({
            where: { reference: document.owner_id, merchantId: merchant.id },
          })
        : null;
      if (document.owner_id && !owner) {
        throw ApiException.validation(
          'owner_not_found',
          `No owner ${document.owner_id} on this merchant.`,
          'owner_id',
        );
      }

      const documentReference = newReference('document');
      const storageKey = join(merchantDir, `${documentReference}-${document.filename}`);
      await writeFile(storageKey, contents);

      created.push(
        await this.prisma.document.create({
          data: {
            reference: documentReference,
            merchantId: merchant.id,
            ownerId: owner?.id,
            documentType: document.type,
            storageKey,
            fileName: document.filename,
            contentType: document.content_type,
            fileSize: contents.byteLength,
            sha256: sha256(contents.toString('base64')),
            expiresAt: document.expires_at ? new Date(document.expires_at) : null,
            metadata: { uploaded_by: principal.actorId } as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    }

    const onFile = await this.prisma.document.findMany({
      where: { merchantId: merchant.id },
      select: { documentType: true },
    });
    const missing = this.compliance
      .requiredDocuments(merchant.country)
      .filter((type) => !onFile.some((document) => document.documentType === type));

    const updated = await this.state.setStepStatus(
      merchant.id,
      'document_upload',
      missing.length === 0 ? 'completed' : 'in_progress',
      missing.map((type) => `upload_document:${type}`),
    );

    await this.audit.record(
      principal,
      {
        action: 'merchant.documents_uploaded',
        resourceType: 'document',
        merchantId: merchant.id,
        resourceId: reference,
        changes: { document_ids: created.map((document) => document.reference) },
      },
      context,
    );

    return {
      data: created.map(serializeDocument),
      missing_documents: missing,
      onboarding: this.state.state(updated),
    };
  }

  async list(principal: Principal, reference: string) {
    const merchant = await this.state.require(principal, reference);
    const documents = await this.prisma.document.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'asc' },
    });
    return { data: documents.map(serializeDocument) };
  }

  /** Documents expiring inside the window, for compliance monitoring and alerts. */
  async expiring(principal: Principal, withinDays: number) {
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    const documents = await this.prisma.document.findMany({
      where: {
        expiresAt: { not: null, lte: cutoff },
        merchant: { partnerId: principal.partnerId },
      },
      include: { merchant: { select: { reference: true } } },
      orderBy: { expiresAt: 'asc' },
    });

    return {
      data: documents.map((document) => ({
        ...serializeDocument(document),
        merchant_id: document.merchant.reference,
      })),
    };
  }
}
