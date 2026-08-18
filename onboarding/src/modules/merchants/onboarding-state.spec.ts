import {
  initialOnboardingState,
  isOnboardingComplete,
  outstandingActions,
  parseOnboardingState,
  setStep,
} from './onboarding-state';

describe('onboarding state machine', () => {
  it('starts every required step as pending with actions', () => {
    const state = initialOnboardingState(['business_verification', 'bank_account_setup']);
    expect(state.steps.map((step) => step.status)).toEqual(['pending', 'pending']);
    expect(outstandingActions(state).length).toBeGreaterThan(0);
    expect(isOnboardingComplete(state)).toBe(false);
  });

  it('completes only the named step and stamps a completion time', () => {
    const state = setStep(
      initialOnboardingState(['business_verification', 'bank_account_setup']),
      'business_verification',
      'completed',
    );
    const [business, bank] = state.steps;
    expect(business.status).toBe('completed');
    expect(business.completed_at).toBeDefined();
    expect(bank.status).toBe('pending');
  });

  it('is complete only when all steps are completed', () => {
    let state = initialOnboardingState(['business_verification', 'bank_account_setup']);
    state = setStep(state, 'business_verification', 'completed');
    expect(isOnboardingComplete(state)).toBe(false);
    state = setStep(state, 'bank_account_setup', 'completed');
    expect(isOnboardingComplete(state)).toBe(true);
    expect(outstandingActions(state)).toEqual([]);
  });

  it('treats a failed step as incomplete and keeps its remediation actions', () => {
    const state = setStep(
      initialOnboardingState(['business_verification']),
      'business_verification',
      'failed',
      ['resubmit_business_details'],
    );
    expect(isOnboardingComplete(state)).toBe(false);
    expect(outstandingActions(state)).toContain('resubmit_business_details');
  });

  it('parses persisted JSON and tolerates malformed values', () => {
    const state = initialOnboardingState(['business_verification']);
    expect(parseOnboardingState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(parseOnboardingState(null).steps).toEqual([]);
    expect(parseOnboardingState('nonsense').steps).toEqual([]);
  });
});
