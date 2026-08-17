import { BusinessType } from '@prisma/client';
import { RegionProfile } from '../compliance/regions';

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface OnboardingStep {
  name: string;
  status: StepStatus;
  required_actions: string[];
  completed_at?: string | null;
}

const INITIAL_ACTIONS: Record<string, string[]> = {
  business_verification: ['submit_business_information'],
  bank_account_setup: ['add_bank_account'],
  owner_verification: ['add_beneficial_owners'],
  tax_id_verification: ['submit_business_information'],
  psd2_sca_attestation: ['accept_sca_attestation'],
  fintrac_registration_check: ['submit_business_information'],
  austrac_reporting_enrolment: ['submit_business_information'],
  manual_compliance_review: ['await_compliance_review'],
};

/**
 * Progressive onboarding: a merchant is created with the minimum viable payload and
 * the remaining work is expressed as steps the partner can complete in any order.
 */
export function buildInitialSteps(
  businessType: BusinessType,
  region: RegionProfile,
): OnboardingStep[] {
  const names = ['business_verification', 'bank_account_setup', 'owner_verification', ...region.additionalSteps];

  return names.map((name) => ({
    name,
    status: 'pending' as StepStatus,
    required_actions:
      name === 'owner_verification' && businessType === BusinessType.individual
        ? ['add_owner_details']
        : (INITIAL_ACTIONS[name] ?? ['await_review']),
    completed_at: null,
  }));
}

export function updateStep(
  steps: OnboardingStep[],
  name: string,
  patch: Partial<Omit<OnboardingStep, 'name'>>,
): OnboardingStep[] {
  return steps.map((step) =>
    step.name === name
      ? {
          ...step,
          ...patch,
          completed_at:
            patch.status === 'completed'
              ? (patch.completed_at ?? new Date().toISOString())
              : (patch.completed_at ?? step.completed_at ?? null),
        }
      : step,
  );
}

export function allStepsCompleted(steps: OnboardingStep[]): boolean {
  return steps.length > 0 && steps.every((step) => step.status === 'completed');
}

export function pendingStepNames(steps: OnboardingStep[]): string[] {
  return steps.filter((step) => step.status !== 'completed').map((step) => step.name);
}

/** Rough completion forecast used for the `estimated_completion` hint. */
export function estimateCompletion(steps: OnboardingStep[], from = new Date()): string {
  const outstanding = pendingStepNames(steps).length;
  const hours = outstanding === 0 ? 0.5 : outstanding * 6;
  return new Date(from.getTime() + hours * 3_600_000).toISOString();
}
