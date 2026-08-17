import { BusinessType } from '@prisma/client';
import { getRegionProfile } from '../compliance/regions';
import {
  allStepsCompleted,
  buildInitialSteps,
  estimateCompletion,
  pendingStepNames,
  updateStep,
} from './onboarding-steps';

describe('buildInitialSteps', () => {
  it('adds the baseline steps plus the region-specific ones', () => {
    const us = buildInitialSteps(BusinessType.company, getRegionProfile('US')).map((s) => s.name);
    const gb = buildInitialSteps(BusinessType.company, getRegionProfile('GB')).map((s) => s.name);

    expect(us).toEqual([
      'business_verification',
      'bank_account_setup',
      'owner_verification',
      'tax_id_verification',
    ]);
    expect(gb).toContain('psd2_sca_attestation');
  });

  it('starts every step pending with actionable next steps', () => {
    const steps = buildInitialSteps(BusinessType.company, getRegionProfile('US'));

    expect(steps.every((step) => step.status === 'pending')).toBe(true);
    expect(steps[0].required_actions).toEqual(['submit_business_information']);
  });

  it('asks a sole trader for owner details rather than beneficial owners', () => {
    const steps = buildInitialSteps(BusinessType.individual, getRegionProfile('US'));
    const owner = steps.find((step) => step.name === 'owner_verification')!;

    expect(owner.required_actions).toEqual(['add_owner_details']);
  });
});

describe('updateStep', () => {
  const steps = buildInitialSteps(BusinessType.company, getRegionProfile('US'));

  it('stamps completed_at when a step completes and leaves others untouched', () => {
    const updated = updateStep(steps, 'business_verification', { status: 'completed' });

    expect(updated[0].status).toBe('completed');
    expect(updated[0].completed_at).not.toBeNull();
    expect(updated[1]).toEqual(steps[1]);
  });

  it('does not stamp completed_at for a failed step', () => {
    const updated = updateStep(steps, 'business_verification', {
      status: 'failed',
      required_actions: ['resubmit_business_information'],
    });

    expect(updated[0].completed_at).toBeNull();
    expect(updated[0].required_actions).toEqual(['resubmit_business_information']);
  });
});

describe('progress helpers', () => {
  const steps = buildInitialSteps(BusinessType.company, getRegionProfile('US'));

  it('reports pending steps and completion', () => {
    expect(allStepsCompleted(steps)).toBe(false);
    expect(pendingStepNames(steps)).toHaveLength(steps.length);

    const done = steps.reduce(
      (acc, step) => updateStep(acc, step.name, { status: 'completed' }),
      steps,
    );
    expect(allStepsCompleted(done)).toBe(true);
    expect(pendingStepNames(done)).toEqual([]);
  });

  it('treats an empty step list as incomplete', () => {
    expect(allStepsCompleted([])).toBe(false);
  });

  it('forecasts sooner completion as steps close out', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const all = estimateCompletion(steps, from);
    const partial = estimateCompletion(updateStep(steps, 'business_verification', { status: 'completed' }), from);

    expect(new Date(partial).getTime()).toBeLessThan(new Date(all).getTime());
  });
});
