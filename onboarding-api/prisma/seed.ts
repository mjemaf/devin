import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

/**
 * Creates a sandbox partner with one API key per role. The raw keys are printed once
 * and never persisted; only their SHA-256 hashes are stored.
 */
async function main(): Promise<void> {
  const partner = await prisma.partner.upsert({
    where: { id: 'pt_sandbox' },
    update: {},
    create: { id: 'pt_sandbox', name: 'Sandbox Partner' },
  });

  const roles: Array<{ role: string; scopes: string[] }> = [
    { role: 'admin', scopes: ['read', 'write', 'admin'] },
    { role: 'operator', scopes: ['read', 'write'] },
    { role: 'viewer', scopes: ['read'] },
  ];

  const issued: Array<{ role: string; key: string }> = [];
  for (const { role, scopes } of roles) {
    const rawKey = `sk_sandbox_${randomBytes(24).toString('base64url')}`;
    await prisma.apiKey.create({
      data: {
        id: newId('ak'),
        partnerId: partner.id,
        name: `sandbox-${role}`,
        keyHash: createHash('sha256').update(rawKey).digest('hex'),
        keyPrefix: rawKey.slice(0, 12),
        scopes,
        role,
      },
    });
    issued.push({ role, key: rawKey });
  }

  console.log(`Seeded partner ${partner.id} (${partner.name}).`);
  console.log('Sandbox API keys (shown once, store them somewhere safe):');
  for (const { role, key } of issued) {
    console.log(`  ${role.padEnd(9)} ${key}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
