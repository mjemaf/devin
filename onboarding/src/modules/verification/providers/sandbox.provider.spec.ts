import { VerificationStatus } from '@prisma/client';
import { SandboxVerificationProvider } from './sandbox.provider';

const provider = new SandboxVerificationProvider();

const business = {
  legalName: 'Acme Corp',
  country: 'US',
  registrationNumber: 'SOS-1',
  taxIdLast4: '6789',
  sources: ['government_registry'],
};

const identity = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1985-12-10',
  country: 'US',
  method: 'database_check' as const,
  hasIdDocument: false,
};

const bank = {
  accountNumberLast4: '6789',
  routingNumber: '121000358',
  accountHolderName: 'Acme Corp',
  currency: 'USD',
  country: 'US',
};

describe('SandboxVerificationProvider', () => {
  it('verifies a well-formed business against the regional registry', async () => {
    const result = await provider.verifyBusiness(business);
    expect(result.status).toBe(VerificationStatus.verified);
    expect(result.details).toMatchObject({ registry: 'secretary_of_state', match: 'exact' });
  });

  it('fails businesses using the FAIL magic value', async () => {
    const result = await provider.verifyBusiness({ ...business, legalName: 'FAIL Corp' });
    expect(result.status).toBe(VerificationStatus.failed);
    expect(result.errorMessage).toBeDefined();
  });

  it('parks businesses using the REVIEW magic value', async () => {
    const result = await provider.verifyBusiness({ ...business, legalName: 'REVIEW Corp' });
    expect(result.status).toBe(VerificationStatus.pending);
  });

  it('verifies identities and fails on the FAIL magic value', async () => {
    await expect(provider.verifyIdentity(identity)).resolves.toMatchObject({
      status: VerificationStatus.verified,
    });
    await expect(
      provider.verifyIdentity({ ...identity, lastName: 'FAIL' }),
    ).resolves.toMatchObject({ status: VerificationStatus.failed });
  });

  it('requests a government id when document upload is chosen without one', async () => {
    const result = await provider.verifyIdentity({ ...identity, method: 'document_upload' });
    expect(result.status).toBe(VerificationStatus.pending);
    expect(result.details).toMatchObject({ required_action: 'upload_government_id' });
  });

  it('fails bank accounts ending in 0000', async () => {
    await expect(provider.verifyBankAccount(bank)).resolves.toMatchObject({
      status: VerificationStatus.verified,
    });
    await expect(
      provider.verifyBankAccount({ ...bank, accountNumberLast4: '0000' }),
    ).resolves.toMatchObject({ status: VerificationStatus.failed });
  });
});
