import { Injectable } from '@nestjs/common';
import { Document, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { ApiException } from '../../common/errors/api.exception';
import { newPublicId } from '../../common/ids';
import { AuthContext } from '../../common/auth/auth.types';
import { MerchantsService } from '../merchants/merchants.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { UploadDocumentsDto } from './dto/upload-documents.dto';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly storage: StorageService,
    private readonly webhooks: WebhookDispatcherService,
  ) {}

  async upload(auth: AuthContext, merchantPublicId: string, dto: UploadDocumentsDto) {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    const documents: Document[] = [];

    for (const input of dto.documents) {
      const contents = Buffer.from(input.file, 'base64');
      if (contents.byteLength === 0) {
        throw ApiException.validation('file is empty', 'invalid_file', 'file');
      }
      if (contents.byteLength > MAX_FILE_BYTES) {
        throw ApiException.validation(
          `file exceeds the ${MAX_FILE_BYTES}-byte limit`,
          'file_too_large',
          'file',
        );
      }

      const ownerId = input.owner_id
        ? (
            await this.prisma.owner.findFirst({
              where: { merchantId: merchant.id, publicId: input.owner_id },
            })
          )?.id
        : undefined;
      if (input.owner_id && !ownerId) {
        throw ApiException.notFound('owner', input.owner_id);
      }

      const publicId = newPublicId('doc');
      const stored = await this.storage.put(`${merchant.publicId}/${publicId}`, contents);
      documents.push(
        await this.prisma.document.create({
          data: {
            publicId,
            merchantId: merchant.id,
            ownerId,
            documentType: input.type,
            filePath: stored.path,
            fileName: input.filename,
            contentType: input.content_type,
            fileSize: stored.size,
            metadata: { sha256: stored.sha256 } as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    }

    await this.webhooks.emit(merchant.partnerId, 'document.uploaded', {
      merchant_id: merchant.publicId,
      document_ids: documents.map((document) => document.publicId),
    });
    return { merchant, documents };
  }

  async list(auth: AuthContext, merchantPublicId: string) {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    return this.prisma.document.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
    });
  }
}
