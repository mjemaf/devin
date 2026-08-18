import { Injectable } from '@nestjs/common';
import { Merchant, MerchantStatus, Prisma } from '@prisma/client';
import { Principal } from '../../common/auth/principal';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OnboardingStepName } from '../compliance/compliance.service';
import {
  OnboardingState,
  StepStatus,
  isOnboardingComplete,
  parseOnboardingState,
  setStep,
} from './onboarding-state';

/**
 * Shared merchant lookup and onboarding-state transitions. Verification, risk and
 * underwriting all mutate merchant state through here, which keeps the status
 * machine in one place and avoids module cycles.
 */
@Injectable()
export class MerchantStateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Enforces partner isolation, and merchant scoping for session tokens. */
  async require(principal: Principal, reference: string): Promise<Merchant> {
    if (principal.merchantReference && principal.merchantReference !== reference) {
      throw ApiException.forbidden(
        'merchant_out_of_scope',
        'This onboarding session token is scoped to a different merchant.',
      );
    }

    const merchant = await this.prisma.merchant.findFirst({
      where:
        principal.role === 'admin' && principal.partnerId === 'platform'
          ? { reference }
          : { reference, partnerId: principal.partnerId },
    });

    if (!merchant) {
      throw ApiException.notFound(
        'merchant_not_found',
        `No merchant found with id ${reference}.`,
      );
    }
    return merchant;
  }

  state(merchant: Merchant): OnboardingState {
    return parseOnboardingState(merchant.onboarding);
  }

  async setStepStatus(
    merchantId: string,
    step: OnboardingStepName,
    status: StepStatus,
    requiredActions: string[] = [],
  ): Promise<Merchant> {
    const merchant = await this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    const next = setStep(this.state(merchant), step, status, requiredActions);

    return this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        onboarding: next as unknown as Prisma.InputJsonValue,
        // Collecting everything moves the application into review; the underwriting
        // engine is what takes it out of review again.
        status:
          isOnboardingComplete(next) && merchant.status === 'pending'
            ? MerchantStatus.under_review
            : merchant.status,
      },
    });
  }

  async setStatus(
    merchantId: string,
    status: MerchantStatus,
    reason?: string,
  ): Promise<Merchant> {
    return this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        status,
        statusReason: reason ?? null,
        activatedAt: status === MerchantStatus.active ? new Date() : undefined,
      },
    });
  }

  async setProcessingLimits(
    merchantId: string,
    limits: Record<string, number>,
  ): Promise<Merchant> {
    return this.prisma.merchant.update({
      where: { id: merchantId },
      data: { processingLimits: limits as unknown as Prisma.InputJsonValue },
    });
  }
}
