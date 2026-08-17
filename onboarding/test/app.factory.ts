import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { SCOPES_BY_ROLE, Role, Scope } from '../src/common/auth/auth.types';
import { apiKeyPrefix, generateApiKey, hashApiKey } from '../src/common/crypto.util';
import { newPublicId } from '../src/common/ids';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { buildValidationPipe } from '../src/common/validation.pipe';

export const BASE = '/v1';

/** Boots the application with the same global configuration as `main.ts`. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return app;
}

export interface TestPartner {
  partnerId: string;
  apiKey: string;
}

export async function createPartner(
  prisma: PrismaService,
  options: { role?: Role; scopes?: Scope[] } = {},
): Promise<TestPartner> {
  const apiKey = generateApiKey('sandbox');
  const role = options.role ?? 'admin';
  const partner = await prisma.partner.create({
    data: {
      publicId: newPublicId('par'),
      name: `Test Partner ${Date.now()}`,
      integration: 'direct_api',
      apiKeys: {
        create: {
          name: 'test',
          role,
          prefix: apiKeyPrefix(apiKey),
          keyHash: hashApiKey(apiKey),
          scopes: options.scopes ?? SCOPES_BY_ROLE[role],
        },
      },
    },
  });
  return { partnerId: partner.id, apiKey };
}

export const merchantPayload = (overrides: Record<string, unknown> = {}) => ({
  business_type: 'company',
  country: 'US',
  email: 'owner@example.com',
  phone: '+14155550123',
  business_name: 'Acme Coffee LLC',
  website: 'https://acme-coffee.example.com',
  mcc: '5812',
  estimated_monthly_volume: 50_000,
  products_sold: ['coffee'],
  ...overrides,
});

export const businessDetailsPayload = (overrides: Record<string, unknown> = {}) => ({
  legal_name: 'Acme Coffee LLC',
  tax_id: '12-3456789',
  registration_number: 'SOS-99887766',
  incorporation_date: '2019-04-01',
  incorporation_country: 'US',
  incorporation_state: 'CA',
  business_address: {
    line1: '1 Market St',
    city: 'San Francisco',
    state: 'CA',
    postal_code: '94105',
    country: 'US',
  },
  ...overrides,
});

export const ownerPayload = (overrides: Record<string, unknown> = {}) => ({
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  phone: '+14155550124',
  date_of_birth: '1985-12-10',
  ownership_percentage: 100,
  title: 'CEO',
  tax_id_last4: '6789',
  address: {
    line1: '1 Market St',
    city: 'San Francisco',
    state: 'CA',
    postal_code: '94105',
    country: 'US',
  },
  ...overrides,
});

export const bankAccountPayload = (overrides: Record<string, unknown> = {}) => ({
  account_number: '000123456789',
  routing_number: '121000358',
  account_type: 'checking',
  currency: 'USD',
  account_holder_name: 'Acme Coffee LLC',
  verification_method: 'instant',
  ...overrides,
});
