import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newReference } from '../../common/util/references';
import { ComplianceService } from '../compliance/compliance.service';
import { CreateOwnersDto } from './dto/create-owners.dto';
import { MerchantStateService } from './merchant-state.service';
import { serializeOwner } from './merchant.serializer';

@Injectable()
export class OwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MerchantStateService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
  ) {}

  async add(
    principal: Principal,
    reference: string,
    dto: CreateOwnersDto,
    context: RequestContext,
  ) {
    const merchant = await this.state.require(principal, reference);
    const rules = this.compliance.rulesFor(merchant.country);

    const existing = await this.prisma.owner.findMany({ where: { merchantId: merchant.id } });
    const totalOwnership =
      existing.reduce((sum, owner) => sum + Number(owner.ownershipPercentage), 0) +
      dto.owners.reduce((sum, owner) => sum + owner.ownership_percentage, 0);

    if (totalOwnership > 100) {
      throw ApiException.validation(
        'ownership_exceeds_total',
        `Combined beneficial ownership would be ${totalOwnership}%, which exceeds 100%.`,
        'owners',
      );
    }

    const created = await this.prisma.$transaction(
      dto.owners.map((owner) =>
        this.prisma.owner.create({
          data: {
            reference: newReference('owner'),
            merchantId: merchant.id,
            firstName: owner.first_name,
            lastName: owner.last_name,
            email: owner.email,
            phone: owner.phone,
            dateOfBirth: new Date(owner.date_of_birth),
            address: owner.address as unknown as Prisma.InputJsonValue,
            ownershipPercentage: new Prisma.Decimal(owner.ownership_percentage),
            title: owner.title,
            nationalIdLast4: owner.national_id_last4,
            isControlProng: owner.is_control_prong ?? false,
          },
        }),
      ),
    );

    const allOwners = [...existing, ...created];
    const disclosed = allOwners.filter(
      (owner) => Number(owner.ownershipPercentage) >= rules.beneficialOwnerThreshold,
    );
    const hasControlProng = allOwners.some((owner) => owner.isControlProng);

    // The step stays open until every owner above the disclosure threshold has been
    // identity-verified, and a control prong is on file.
    const pendingActions = [
      ...(hasControlProng ? [] : ['designate_control_prong']),
      ...disclosed
        .filter((owner) => owner.verificationStatus !== 'verified')
        .map((owner) => `verify_identity:${owner.reference}`),
    ];

    const updated = await this.state.setStepStatus(
      merchant.id,
      'owner_verification',
      pendingActions.length === 0 ? 'completed' : 'in_progress',
      pendingActions,
    );

    await this.audit.record(
      principal,
      {
        action: 'merchant.owners_added',
        resourceType: 'owner',
        merchantId: merchant.id,
        resourceId: reference,
        changes: { owner_ids: created.map((owner) => owner.reference) },
      },
      context,
    );

    return {
      data: created.map(serializeOwner),
      beneficial_owner_threshold: rules.beneficialOwnerThreshold,
      onboarding: this.state.state(updated),
    };
  }

  async list(principal: Principal, reference: string) {
    const merchant = await this.state.require(principal, reference);
    const owners = await this.prisma.owner.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'asc' },
    });
    return { data: owners.map(serializeOwner) };
  }
}
