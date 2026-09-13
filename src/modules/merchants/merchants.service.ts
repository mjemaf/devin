import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateMerchantDto } from '../../common/dto/create-merchant.dto';
import { BusinessVerificationDto } from '../../common/dto/business-verification.dto';
import { CreateBankAccountDto } from '../../common/dto/bank-account.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MerchantsService {
  constructor(private prisma: PrismaService) {}

  async createMerchant(createMerchantDto: CreateMerchantDto, partnerId: string) {
    const onboardingToken = uuidv4();

    const merchant = await this.prisma.merchant.create({
      data: {
        businessType: createMerchantDto.business_type,
        status: 'pending_verification',
        businessProfile: {
          legal_name: createMerchantDto.business_name,
          dba_name: createMerchantDto.business_name,
          mcc: createMerchantDto.mcc,
          website: createMerchantDto.website,
          estimated_monthly_volume: createMerchantDto.estimated_monthly_volume,
          products_sold: createMerchantDto.products_sold,
        },
        contact: {
          email: createMerchantDto.email,
          phone: createMerchantDto.phone,
        },
        address: {
          country: createMerchantDto.country,
        },
        compliance: {
          pci_level: 'pending',
          gdpr_compliant: false,
          regional_compliance: [],
        },
        partnerId,
      },
    });

    return {
      merchant_id: merchant.id,
      status: merchant.status,
      onboarding_token: onboardingToken,
      required_steps: [
        'business_verification',
        'bank_account_setup',
        'owner_verification',
      ],
      created_at: merchant.createdAt,
    };
  }

  async getMerchant(merchantId: string, partnerId: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: merchantId,
        partnerId,
      },
      include: {
        owners: true,
        bankAccounts: true,
        documents: true,
      },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    return merchant;
  }

  async submitBusinessVerification(
    merchantId: string,
    businessVerificationDto: BusinessVerificationDto,
    partnerId: string,
  ) {
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: merchantId,
        partnerId,
      },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    const updatedMerchant = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        businessProfile: {
          ...(merchant.businessProfile as any),
          legal_name: businessVerificationDto.legal_name,
          dba_name: businessVerificationDto.dba_name,
          tax_id: businessVerificationDto.tax_id,
          registration_number: businessVerificationDto.registration_number,
          incorporation_date: businessVerificationDto.incorporation_date,
          incorporation_country: businessVerificationDto.incorporation_country,
          incorporation_state: businessVerificationDto.incorporation_state,
        },
        address: businessVerificationDto.business_address as any,
        status: 'under_review',
      },
    });

    return {
      merchant_id: updatedMerchant.id,
      status: updatedMerchant.status,
      message: 'Business verification submitted successfully',
    };
  }

  async addBankAccount(
    merchantId: string,
    createBankAccountDto: CreateBankAccountDto,
    partnerId: string,
  ) {
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: merchantId,
        partnerId,
      },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    const accountNumberLast4 = createBankAccountDto.account_number.slice(-4);

    const bankAccount = await this.prisma.bankAccount.create({
      data: {
        merchantId,
        accountNumberLast4,
        routingNumber: createBankAccountDto.routing_number,
        accountType: createBankAccountDto.account_type,
        currency: createBankAccountDto.currency,
        accountHolderName: createBankAccountDto.account_holder_name,
        verificationMethod: createBankAccountDto.verification_method,
        isDefault: true,
      },
    });

    return {
      bank_account_id: bankAccount.id,
      account_number_last4: bankAccount.accountNumberLast4,
      verification_status: bankAccount.verificationStatus,
      verification_method: bankAccount.verificationMethod,
    };
  }

  async getMerchantStatus(merchantId: string, partnerId: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: merchantId,
        partnerId,
      },
      include: {
        owners: true,
        bankAccounts: true,
        documents: true,
      },
    });

    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    const steps = [
      {
        name: 'business_verification',
        status: this.getBusinessVerificationStatus(merchant),
        completed_at: (merchant.businessProfile as any)?.tax_id ? new Date() : null,
      },
      {
        name: 'bank_account_setup',
        status: this.getBankAccountStatus(merchant.bankAccounts),
        required_actions: merchant.bankAccounts.length === 0 ? ['add_bank_account'] : [],
      },
      {
        name: 'owner_verification',
        status: this.getOwnerVerificationStatus(merchant.owners),
        required_actions: merchant.owners.length === 0 ? ['add_owners'] : [],
      },
    ];

    return {
      merchant_id: merchant.id,
      overall_status: merchant.status,
      steps,
      estimated_completion: this.estimateCompletion(merchant.status),
    };
  }

  private getBusinessVerificationStatus(merchant: any): string {
    if (merchant.businessProfile?.tax_id && merchant.address?.line1) {
      return 'completed';
    }
    return 'pending';
  }

  private getBankAccountStatus(bankAccounts: any[]): string {
    if (bankAccounts.length === 0) return 'pending';
    const verified = bankAccounts.some((ba) => ba.verificationStatus === 'verified');
    return verified ? 'completed' : 'in_progress';
  }

  private getOwnerVerificationStatus(owners: any[]): string {
    if (owners.length === 0) return 'pending';
    const verified = owners.every((owner) => owner.verificationStatus === 'verified');
    return verified ? 'completed' : 'in_progress';
  }

  private estimateCompletion(status: string): Date {
    const now = new Date();
    switch (status) {
      case 'pending_verification':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day
      case 'under_review':
        return new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
      case 'approved':
        return now;
      default:
        return new Date(now.getTime() + 48 * 60 * 60 * 1000); // 2 days
    }
  }
}