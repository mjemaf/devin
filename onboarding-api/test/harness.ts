import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

export interface PartnerCredentials {
  partnerId: string;
  adminKey: string;
  operatorKey: string;
  viewerKey: string;
}

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  partner: PartnerCredentials;
  otherPartner: PartnerCredentials;
  close(): Promise<void>;
}

const ROLE_SCOPES: Record<string, string[]> = {
  admin: ['read', 'write', 'admin'],
  operator: ['read', 'write'],
  viewer: ['read'],
};

async function createPartner(prisma: PrismaService, label: string): Promise<PartnerCredentials> {
  const partnerId = `pt_e2e_${label}_${randomBytes(6).toString('hex')}`;
  await prisma.partner.create({ data: { id: partnerId, name: `E2E ${label}` } });

  const keys: Record<string, string> = {};
  for (const [role, scopes] of Object.entries(ROLE_SCOPES)) {
    const rawKey = `sk_test_${randomBytes(18).toString('base64url')}`;
    await prisma.apiKey.create({
      data: {
        id: `ak_e2e_${randomBytes(8).toString('hex')}`,
        partnerId,
        name: `${label}-${role}`,
        keyHash: createHash('sha256').update(rawKey).digest('hex'),
        keyPrefix: rawKey.slice(0, 12),
        scopes,
        role,
      },
    });
    keys[role] = rawKey;
  }

  return {
    partnerId,
    adminKey: keys.admin,
    operatorKey: keys.operator,
    viewerKey: keys.viewer,
  };
}

export async function startHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  app.useLogger(false);
  await app.init();

  const prisma = app.get(PrismaService);
  const partner = await createPartner(prisma, 'primary');
  const otherPartner = await createPartner(prisma, 'other');

  return {
    app,
    prisma,
    partner,
    otherPartner,
    async close() {
      for (const id of [partner.partnerId, otherPartner.partnerId]) {
        await prisma.partner.delete({ where: { id } }).catch(() => undefined);
      }
      await app.close();
    },
  };
}
