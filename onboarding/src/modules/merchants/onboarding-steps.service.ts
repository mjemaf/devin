import { Injectable } from '@nestjs/common';
import { BusinessType, Prisma, StepStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OnboardingStepName, requiredSteps } from '../compliance/regional-requirements';

const INITIAL_REQUIRED_ACTIONS: Record<OnboardingStepName, string[]> = {
  business_verification: ['submit_business_details'],
  bank_account_setup: ['add_bank_account', 'verify_bank_account'],
  owner_verification: ['add_beneficial_owners', 'verify_owner_identity'],
  underwriting: ['submit_for_underwriting'],
};

/** Owns the per-merchant onboarding checklist that drives `GET /merchants/{id}/status`. */
@Injectable()
export class OnboardingStepsService {
  constructor(private readonly prisma: PrismaService) {}

  seedData(businessType: BusinessType): Prisma.OnboardingStepCreateWithoutMerchantInput[] {
    return requiredSteps(businessType).map((name, index) => ({
      name,
      position: index,
      requiredActions: INITIAL_REQUIRED_ACTIONS[name],
    }));
  }

  async complete(merchantId: string, name: OnboardingStepName): Promise<void> {
    await this.prisma.onboardingStep.updateMany({
      where: { merchantId, name },
      data: { status: StepStatus.completed, requiredActions: [], completedAt: new Date() },
    });
  }

  async setStatus(
    merchantId: string,
    name: OnboardingStepName,
    status: StepStatus,
    requiredActions: string[] = [],
  ): Promise<void> {
    await this.prisma.onboardingStep.updateMany({
      where: { merchantId, name },
      data: {
        status,
        requiredActions,
        completedAt: status === StepStatus.completed ? new Date() : null,
      },
    });
  }

  async allCompleteExceptUnderwriting(merchantId: string): Promise<boolean> {
    const outstanding = await this.prisma.onboardingStep.count({
      where: {
        merchantId,
        name: { not: 'underwriting' },
        status: { not: StepStatus.completed },
      },
    });
    return outstanding === 0;
  }
}
