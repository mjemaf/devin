import { Injectable } from '@nestjs/common';
import { Merchant, MerchantStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/errors/api.exception';
import { allStepsCompleted, OnboardingStep, StepStatus, updateStep } from './onboarding-steps';

/** Statuses that are terminal for onboarding progress and must not be recomputed. */
const DECIDED_STATUSES: MerchantStatus[] = [
  MerchantStatus.approved,
  MerchantStatus.active,
  MerchantStatus.declined,
  MerchantStatus.suspended,
];

/**
 * Shared read/write access to merchant onboarding state. Lives outside `MerchantsService`
 * so the verification, risk and underwriting modules can advance a merchant without
 * depending on the (much larger) merchants module.
 */
@Injectable()
export class MerchantStateService {
  constructor(private readonly prisma: PrismaService) {}

  async findForPartner(partnerId: string, merchantId: string): Promise<Merchant> {
    const merchant = await this.prisma.merchant.findFirst({ where: { id: merchantId, partnerId } });
    if (!merchant) throw ApiException.notFound('merchant', merchantId);
    return merchant;
  }

  steps(merchant: Merchant): OnboardingStep[] {
    return (merchant.onboardingSteps as unknown as OnboardingStep[]) ?? [];
  }

  async advanceStep(
    merchant: Merchant,
    stepName: string,
    status: StepStatus,
    requiredActions: string[] = [],
  ): Promise<Merchant> {
    const steps = updateStep(this.steps(merchant), stepName, {
      status,
      required_actions: requiredActions,
    });

    return this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        onboardingSteps: steps as unknown as Prisma.InputJsonValue,
        status: this.nextStatus(merchant.status, steps),
      },
    });
  }

  async setStatus(merchantId: string, status: MerchantStatus): Promise<Merchant> {
    return this.prisma.merchant.update({ where: { id: merchantId }, data: { status } });
  }

  /** Onboarding progress drives status until a human or the engine makes a decision. */
  nextStatus(current: MerchantStatus, steps: OnboardingStep[]): MerchantStatus {
    if (DECIDED_STATUSES.includes(current)) return current;
    if (steps.some((step) => step.status === 'failed')) return MerchantStatus.under_review;
    if (allStepsCompleted(steps)) return MerchantStatus.under_review;
    return MerchantStatus.pending_verification;
  }
}
