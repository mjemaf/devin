import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newPublicId } from '../../common/ids';
import { ApiException } from '../../common/errors/api.exception';
import { CreateWebhookDto } from './dto/create-webhook.dto';

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  async register(partnerId: string, dto: CreateWebhookDto) {
    const secret = dto.secret ?? `whsec_${randomBytes(24).toString('hex')}`;
    const webhook = await this.prisma.webhook.create({
      data: {
        publicId: newPublicId('wh'),
        partnerId,
        url: dto.url,
        events: dto.events,
        secret,
      },
    });
    return { webhook, secret };
  }

  async list(partnerId: string) {
    return this.prisma.webhook.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivate(partnerId: string, publicId: string) {
    const webhook = await this.prisma.webhook.findFirst({ where: { partnerId, publicId } });
    if (!webhook) {
      throw ApiException.notFound('webhook', publicId);
    }
    return this.prisma.webhook.update({ where: { id: webhook.id }, data: { isActive: false } });
  }

  async deliveries(partnerId: string, publicId: string) {
    const webhook = await this.prisma.webhook.findFirst({ where: { partnerId, publicId } });
    if (!webhook) {
      throw ApiException.notFound('webhook', publicId);
    }
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId: webhook.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
