import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const SCOPES = [
  'merchants:read',
  'merchants:write',
  'verification:write',
  'risk:read',
  'risk:write',
  'underwriting:read',
  'underwriting:write',
  'webhooks:read',
  'webhooks:write',
  'analytics:read',
];

/**
 * Creates a demo partner with a full-scope test key. The secret is printed once and
 * only its hash is stored, matching the runtime key model.
 */
async function main(): Promise<void> {
  const partner = await prisma.partner.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Demo Platform',
      integrationMode: 'direct_api',
      defaultLocale: 'en-US',
    },
  });

  const prefix = `sk_test_${randomBytes(4).toString('hex')}`;
  const secret = `${prefix}.${randomBytes(12).toString('hex')}`;

  await prisma.apiKey.create({
    data: {
      partnerId: partner.id,
      prefix,
      keyHash: createHash('sha256').update(secret).digest('hex'),
      scopes: SCOPES,
      role: 'admin',
      livemode: false,
    },
  });

  process.stdout.write(
    `Seeded partner ${partner.id}\nAPI key (store it now, it is not recoverable): ${secret}\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
