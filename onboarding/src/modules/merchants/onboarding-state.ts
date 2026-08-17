import { OnboardingStepName } from '../compliance/compliance.service';

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface OnboardingStepState {
  name: OnboardingStepName;
  status: StepStatus;
  required_actions: string[];
  completed_at?: string;
}

export interface OnboardingState {
  steps: OnboardingStepState[];
  /** Free-form scratch space for progressive onboarding (partially completed forms). */
  draft?: Record<string, unknown>;
}

const INITIAL_ACTIONS: Record<OnboardingStepName, string[]> = {
  business_verification: ['submit_business_information'],
  bank_account_setup: ['add_bank_account'],
  owner_verification: ['add_beneficial_owners'],
  document_upload: ['upload_required_documents'],
};

export function initialOnboardingState(steps: OnboardingStepName[]): OnboardingState {
  return {
    steps: steps.map((name) => ({
      name,
      status: 'pending',
      required_actions: INITIAL_ACTIONS[name],
    })),
  };
}

export function setStep(
  state: OnboardingState,
  name: OnboardingStepName,
  status: StepStatus,
  requiredActions: string[] = [],
): OnboardingState {
  const steps = state.steps.map((step) =>
    step.name === name
      ? {
          ...step,
          status,
          required_actions: requiredActions,
          completed_at: status === 'completed' ? new Date().toISOString() : undefined,
        }
      : step,
  );
  return { ...state, steps };
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return state.steps.every((step) => step.status === 'completed');
}

export function outstandingActions(state: OnboardingState): string[] {
  return state.steps.filter((step) => step.status !== 'completed').flatMap((step) => step.required_actions);
}

export function parseOnboardingState(value: unknown): OnboardingState {
  const candidate = value as OnboardingState | null;
  if (!candidate || !Array.isArray(candidate.steps)) {
    return { steps: [] };
  }
  return candidate;
}
