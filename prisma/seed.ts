import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

async function main() {
  console.log('🌱 Starting seed...');

  // Create a test partner
  const partner = await prisma.partner.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      name: 'Test Partner',
      email: 'test@example.com',
      apiKey: 'pk_test_1234567890abcdef',
      apiSecret: await bcrypt.hash('test_secret', 10),
      isActive: true,
    },
  });

  console.log('✅ Created test partner:', partner);

  // Create a sample merchant
  const merchant = await prisma.merchant.create({
    data: {
      businessType: 'company',
      status: 'pending_verification',
      businessProfile: {
        legal_name: 'Test Business Inc',
        dba_name: 'Test Store',
        tax_id: '12-3456789',
        mcc: '5734',
        website: 'https://testbusiness.com',
        estimated_monthly_volume: 50000,
        products_sold: ['electronics', 'software'],
      },
      contact: {
        email: 'merchant@testbusiness.com',
        phone: '+1234567890',
      },
      address: {
        line1: '123 Main St',
        line2: 'Suite 100',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105',
        country: 'US',
      },
      compliance: {
        pci_level: 'pending',
        gdpr_compliant: false,
        regional_compliance: [],
      },
      partnerId: partner.id,
    },
  });

  console.log('✅ Created sample merchant:', merchant);

  // Create a sample bank account
  const bankAccount = await prisma.bankAccount.create({
    data: {
      merchantId: merchant.id,
      accountNumberLast4: '1234',
      routingNumber: '021000021',
      accountType: 'checking',
      currency: 'USD',
      accountHolderName: 'Test Business Inc',
      verificationMethod: 'instant',
      isDefault: true,
    },
  });

  console.log('✅ Created sample bank account:', bankAccount);

  // Create a sample webhook
  const webhook = await prisma.webhook.create({
    data: {
      partnerId: partner.id,
      url: 'https://example.com/webhook',
      events: ['merchant.underwriting_approved', 'merchant.verification_completed'],
      secret: 'whsec_test123',
    },
  });

  console.log('✅ Created sample webhook:', webhook);

  console.log('🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });