import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  constructor(private prisma: PrismaService) {}

  async registerWebhook(partnerId: string, url: string, events: string[], secret: string) {
    // Generate a secret if not provided
    const webhookSecret = secret || `whsec_${uuidv4()}`;

    const webhook = await this.prisma.webhook.create({
      data: {
        partnerId,
        url,
        events,
        secret: webhookSecret,
      },
    });

    return {
      webhook_id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      secret: webhook.secret,
      created_at: webhook.createdAt,
    };
  }

  async triggerWebhook(eventType: string, data: any, partnerId: string) {
    // Find all webhooks for this partner that are subscribed to this event
    const webhooks = await this.prisma.webhook.findMany({
      where: {
        partnerId,
        isActive: true,
      },
    });

    // Filter webhooks that are subscribed to this event
    const matchingWebhooks = webhooks.filter(webhook => 
      Array.isArray(webhook.events) && webhook.events.includes(eventType)
    );

    // Send webhook to each registered endpoint
    const results = await Promise.allSettled(
      matchingWebhooks.map((webhook) => this.sendWebhook(webhook, eventType, data)),
    );

    return {
      triggered: matchingWebhooks.length,
      successful: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    };
  }

  private async sendWebhook(webhook: any, eventType: string, data: any) {
    const payload = {
      id: uuidv4(),
      event_type: eventType,
      data,
      created_at: new Date().toISOString(),
    };

    // Generate signature
    const signature = this.generateSignature(payload, webhook.secret);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-ID': payload.id,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.statusText}`);
      }

      return { success: true, webhook_id: webhook.id };
    } catch (error) {
      console.error(`Webhook delivery failed for ${webhook.id}:`, error);
      return { success: false, webhook_id: webhook.id, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private generateSignature(payload: any, secret: string): string {
    const payloadString = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadString);
    return `sha256=${hmac.digest('hex')}`;
  }

  async getWebhooks(partnerId: string) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { partnerId },
    });

    return webhooks.map((webhook) => ({
      webhook_id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      is_active: webhook.isActive,
      created_at: webhook.createdAt,
    }));
  }

  async deleteWebhook(webhookId: string, partnerId: string) {
    const webhook = await this.prisma.webhook.findFirst({
      where: {
        id: webhookId,
        partnerId,
      },
    });

    if (!webhook) {
      throw new Error('Webhook not found');
    }

    await this.prisma.webhook.delete({
      where: { id: webhookId },
    });

    return { message: 'Webhook deleted successfully' };
  }
}