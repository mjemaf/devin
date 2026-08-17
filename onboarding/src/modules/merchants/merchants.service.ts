import { Injectable } from '@nestjs/common';
import {
  BusinessType,
  Merchant,
  MerchantStatus,
  Prisma,
  StepStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api.exception';
import { newPublicId } from '../../common/ids';
import { last4, tokenize } from '../../common/crypto.util';
import { AuthContext } from '../../common/auth/auth.types';
import { complianceProfileFor, toJson } from '../compliance/compliance';
import { regionalProfile, requiredSteps } from '../compliance/regional-requirements';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { BusinessVerificationDto } from './dto/business-verification.dto';
import { OnboardingStepsService } from './onboarding-steps.service';
import { MerchantWithRelations } from './merchant.presenter';

interface BusinessProfile {
  legal_name: string;
  dba_name: string | null;
  mcc: string;
  website: string | null;
  estimated_monthly_volume: number;
  products_sold: string[];
  tax_id_token?: string;
  tax_id_last4?: string;
  registration_number?: string;
  incorporation_date?: string;
  incorporation_country?: string;
  incorporation_state?: string;
}

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly steps: OnboardingStepsService,
    private readonly webhooks: WebhookDispatcherService,
    private readonly config: ConfigService,
  ) {}

  async create(auth: AuthContext, dto: CreateMerchantDto): Promise<MerchantWithRelations> {
    const country = dto.country.toUpperCase();
    const businessProfile: BusinessProfile = {
      legal_name: dto.business_name,
      dba_name: null,
      mcc: dto.mcc,
      website: dto.website ?? null,
      estimated_monthly_volume: dto.estimated_monthly_volume,
      products_sold: dto.products_sold ?? [],
    };

    const merchant = await this.prisma.merchant.create({
      data: {
        publicId: newPublicId('mer'),
        partnerId: auth.partnerId,
        businessType: dto.business_type,
        country,
        businessProfile: businessProfile as unknown as Prisma.InputJsonValue,
        contact: { email: dto.email, phone: dto.phone },
        compliance: toJson(complianceProfileFor(country, dto.business_type)),
        steps: { create: this.steps.seedData(dto.business_type) },
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });

    await this.webhooks.emit(auth.partnerId, 'merchant.created', {
      merchant_id: merchant.publicId,
      status: merchant.status,
    });
    return merchant;
  }

  requiredStepNames(businessType: BusinessType): string[] {
    return requiredSteps(businessType);
  }

  async findForPartner(auth: AuthContext, publicId: string): Promise<Merchant> {
    if (auth.merchantPublicId && auth.merchantPublicId !== publicId) {
      throw ApiException.forbidden(
        'Onboarding token is scoped to a different merchant',
        'merchant_scope_mismatch',
      );
    }
    const merchant = await this.prisma.merchant.findFirst({
      where: { publicId, partnerId: auth.partnerId },
    });
    if (!merchant) {
      throw ApiException.notFound('merchant', publicId);
    }
    return merchant;
  }

  async findWithRelations(auth: AuthContext, publicId: string): Promise<MerchantWithRelations> {
    const merchant = await this.findForPartner(auth, publicId);
    return this.prisma.merchant.findUniqueOrThrow({
      where: { id: merchant.id },
      include: {
        steps: { orderBy: { position: 'asc' } },
        owners: true,
        bankAccounts: true,
        documents: true,
      },
    });
  }

  async list(auth: AuthContext, status: MerchantStatus | undefined, limit: number, offset: number) {
    const where: Prisma.MerchantWhereInput = { partnerId: auth.partnerId, status };
    const [data, total] = await Promise.all([
      this.prisma.merchant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { steps: { orderBy: { position: 'asc' } } },
      }),
      this.prisma.merchant.count({ where }),
    ]);
    return { data, total };
  }

  async update(
    auth: AuthContext,
    publicId: string,
    dto: UpdateMerchantDto,
  ): Promise<MerchantWithRelations> {
    const merchant = await this.findForPartner(auth, publicId);
    this.assertMutable(merchant);
    const profile = merchant.businessProfile as unknown as BusinessProfile;
    const contact = merchant.contact as { email: string; phone: string };

    const updated = await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        contact: {
          email: dto.email ?? contact.email,
          phone: dto.phone ?? contact.phone,
        },
        address: dto.address
          ? (dto.address as unknown as Prisma.InputJsonValue)
          : (merchant.address ?? undefined),
        businessProfile: {
          ...profile,
          dba_name: dto.dba_name ?? profile.dba_name,
          website: dto.website ?? profile.website,
          estimated_monthly_volume:
            dto.estimated_monthly_volume ?? profile.estimated_monthly_volume,
        } as unknown as Prisma.InputJsonValue,
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });

    await this.webhooks.emit(auth.partnerId, 'merchant.updated', {
      merchant_id: updated.publicId,
      fields: Object.keys(dto),
    });
    return updated;
  }

  /**
   * Persists KYB details and marks `business_verification` in progress; the actual
   * registry/bureau checks run through POST /verify/business.
   */
  async submitBusinessDetails(
    auth: AuthContext,
    publicId: string,
    dto: BusinessVerificationDto,
  ): Promise<MerchantWithRelations> {
    const merchant = await this.findForPartner(auth, publicId);
    this.assertMutable(merchant);

    const region = regionalProfile(merchant.country);
    if (region.businessRegistry && !dto.registration_number && merchant.businessType === 'company') {
      throw ApiException.validation(
        `registration_number is required for companies in ${merchant.country}`,
        'missing_required_parameter',
        'registration_number',
      );
    }

    const profile = merchant.businessProfile as unknown as BusinessProfile;
    const secret = this.config.getOrThrow<string>('jwtSecret');
    const updated = await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        status: MerchantStatus.under_review,
        address: dto.business_address as unknown as Prisma.InputJsonValue,
        businessProfile: {
          ...profile,
          legal_name: dto.legal_name,
          dba_name: dto.dba_name ?? profile.dba_name,
          tax_id_token: tokenize(dto.tax_id, secret),
          tax_id_last4: last4(dto.tax_id),
          registration_number: dto.registration_number,
          incorporation_date: dto.incorporation_date,
          incorporation_country: dto.incorporation_country.toUpperCase(),
          incorporation_state: dto.incorporation_state,
        } as unknown as Prisma.InputJsonValue,
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });

    await this.steps.setStatus(merchant.id, 'business_verification', StepStatus.in_progress, [
      'await_business_verification',
    ]);
    return updated;
  }

  async setStatus(
    auth: AuthContext,
    publicId: string,
    status: MerchantStatus,
  ): Promise<MerchantWithRelations> {
    const merchant = await this.findForPartner(auth, publicId);
    const updated = await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: { status },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    await this.webhooks.emit(
      auth.partnerId,
      status === MerchantStatus.suspended ? 'merchant.suspended' : 'merchant.activated',
      { merchant_id: updated.publicId, status },
    );
    return updated;
  }

  private assertMutable(merchant: Merchant): void {
    if (merchant.status === MerchantStatus.suspended || merchant.status === MerchantStatus.declined) {
      throw ApiException.conflict(
        `Merchant ${merchant.publicId} is ${merchant.status} and cannot be modified`,
        'merchant_not_mutable',
      );
    }
  }
}
