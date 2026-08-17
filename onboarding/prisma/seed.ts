import { PrismaClient } from '@prisma/client';
import { apiKeyPrefix, hashApiKey } from '../src/common/crypto.util';
import { newPublicId } from '../src/common/ids';
import { SCOPES_BY_ROLE } from '../src/common/auth/auth.types';

const prisma = new PrismaClient();

/**
 * Seeds a sandbox partner whose API key is fixed by SEED_PARTNER_API_KEY so local
 * and CI callers have a stable credential.
 */
async function main(): Promise<void> {
  const apiKey = process.env.SEED_PARTNER_API_KEY ?? 'sk_sandbox_devin_local';
  const existing = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(apiKey) } });
  if (existing) {
    console.log('Sandbox partner already seeded');
    return;
  }

  const partner = await prisma.partner.create({
    data: {
      publicId: newPublicId('par'),
      name: 'Sandbox Partner',
      integration: 'direct_api',
      apiKeys: {
        create: {
          name: 'sandbox-default',
          role: 'admin',
          prefix: apiKeyPrefix(apiKey),
          keyHash: hashApiKey(apiKey),
          scopes: SCOPES_BY_ROLE.admin,
        },
      },
    },
  });
  console.log(`Seeded partner ${partner.publicId} with API key ${apiKey}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
