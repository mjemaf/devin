import {
  MockBankProvider,
  MockBusinessProvider,
  MockIdentityProvider,
  SANDBOX_TRIGGERS,
} from './mock-providers';

const businessRequest = {
  merchantReference: 'mer_test',
  country: 'US',
  legalName: 'Smoke Coffee LLC',
  registrationNumber: 'C1234567',
  taxIdLast4: '6789',
  address: { country: 'US' },
  mcc: '5812',
  sources: ['government_registry'],
  priority: 'standard' as const,
};

const identityRequest = {
  ownerReference: 'owner_test',
  country: 'US',
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1985-12-10',
  address: { country: 'US' },
  method: 'database_check' as const,
  hasIdDocument: true,
};

const bankRequest = {
  bankAccountReference: 'ba_test',
  country: 'US',
  accountHolderName: 'Smoke Coffee LLC',
  merchantLegalName: 'Smoke Coffee LLC',
  accountNumberLast4: '6789',
  routingNumber: '121000248',
  method: 'instant' as const,
};

describe('sandbox verification providers', () => {
  it('verifies a well-formed business', async () => {
    const result = await new MockBusinessProvider().verifyBusiness(businessRequest);
    expect(result.outcome).toBe('verified');
    expect(result.registryStatus).toBe('active');
    expect(result.screeningHits).toEqual([]);
  });

  it('fails KYB for the registry-miss trigger', async () => {
    const result = await new MockBusinessProvider().verifyBusiness({
      ...businessRequest,
      legalName: SANDBOX_TRIGGERS.businessNotFound,
    });
    expect(result.outcome).toBe('failed');
    expect(result.registryStatus).toBe('not_found');
    expect(result.failureReason).toBeDefined();
  });

  it('surfaces sanctions hits for the screening trigger', async () => {
    const result = await new MockBusinessProvider().verifyBusiness({
      ...businessRequest,
      legalName: `Bad ${SANDBOX_TRIGGERS.sanctionsHit} Corp`,
    });
    expect(result.outcome).toBe('failed');
    expect(result.screeningHits.length).toBeGreaterThan(0);
  });

  it('verifies an identity and fails the reserved national id', async () => {
    const provider = new MockIdentityProvider();
    await expect(provider.verifyIdentity(identityRequest)).resolves.toMatchObject({
      outcome: 'verified',
    });
    await expect(
      provider.verifyIdentity({
        ...identityRequest,
        nationalIdLast4: SANDBOX_TRIGGERS.identityFailureIdLast4,
      }),
    ).resolves.toMatchObject({ outcome: 'failed' });
  });

  it('verifies bank accounts instantly and reports closed accounts', async () => {
    const provider = new MockBankProvider();
    await expect(provider.verifyBankAccount(bankRequest)).resolves.toMatchObject({
      outcome: 'verified',
    });
    await expect(
      provider.verifyBankAccount({
        ...bankRequest,
        routingNumber: SANDBOX_TRIGGERS.bankClosedRoutingNumber,
      }),
    ).resolves.toMatchObject({ outcome: 'failed' });
  });

  it('leaves micro-deposit verification pending confirmation', async () => {
    const result = await new MockBankProvider().verifyBankAccount({
      ...bankRequest,
      method: 'micro_deposits',
    });
    expect(result.outcome).toBe('in_progress');
    expect(result.microDeposits?.length).toBeGreaterThan(0);
  });
});
