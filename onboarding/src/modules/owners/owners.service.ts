import { Injectable } from '@nestjs/common';
import { BusinessType, Prisma, StepStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api.exception';
import { newPublicId } from '../../common/ids';
import { AuthContext } from '../../common/auth/auth.types';
import { MerchantsService } from '../merchants/merchants.service';
import { OnboardingStepsService } from '../merchants/onboarding-steps.service';
import { CreateOwnersDto } from './dto/create-owners.dto';

/** Beneficial ownership below this threshold does not need to be disclosed. */
export const BENEFICIAL_OWNER_THRESHOLD = 25;

@Injectable()
export class OwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly steps: OnboardingStepsService,
  ) {}

  async addOwners(auth: AuthContext, merchantPublicId: string, dto: CreateOwnersDto) {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    if (merchant.businessType !== BusinessType.company) {
      throw ApiException.validation(
        'Beneficial owners can only be added to company merchants',
        'unsupported_for_business_type',
        'owners',
      );
    }

    const existing = await this.prisma.owner.findMany({ where: { merchantId: merchant.id } });
    const total =
      existing.reduce((sum, owner) => sum + Number(owner.ownershipPercentage), 0) +
      dto.owners.reduce((sum, owner) => sum + owner.ownership_percentage, 0);
    if (total > 100) {
      throw ApiException.validation(
        'Combined ownership_percentage across owners cannot exceed 100',
        'invalid_ownership_total',
        'ownership_percentage',
      );
    }

    const created = await this.prisma.$transaction(
      dto.owners.map((owner) =>
        this.prisma.owner.create({
          data: {
            publicId: newPublicId('owner'),
            merchantId: merchant.id,
            firstName: owner.first_name,
            lastName: owner.last_name,
            email: owner.email,
            phone: owner.phone,
            dateOfBirth: new Date(owner.date_of_birth),
            address: owner.address as unknown as Prisma.InputJsonValue,
            ownershipPercentage: new Prisma.Decimal(owner.ownership_percentage),
            title: owner.title,
            taxIdLast4: owner.tax_id_last4,
            isControlPerson:
              owner.is_control_person ?? owner.ownership_percentage >= BENEFICIAL_OWNER_THRESHOLD,
          },
        }),
      ),
    );

    await this.steps.setStatus(merchant.id, 'owner_verification', StepStatus.in_progress, [
      'verify_owner_identity',
    ]);
    return { merchant, owners: created };
  }

  async list(auth: AuthContext, merchantPublicId: string) {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    return this.prisma.owner.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'asc' },
    });
  }
}
