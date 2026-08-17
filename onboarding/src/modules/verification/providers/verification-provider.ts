import { VerificationStatus } from '@prisma/client';

export interface BusinessVerificationRequest {
  legalName: string;
  taxIdLast4?: string;
  registrationNumber?: string;
  country: string;
  sources: string[];
}

export interface IdentityVerificationRequest {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  country: string;
  method: string;
  hasIdDocument: boolean;
}

export interface BankAccountVerificationRequest {
  routingNumber: string;
  accountNumberLast4: string;
  accountHolderName: string;
  currency: string;
}

export interface ProviderResult {
  status: VerificationStatus;
  provider: string;
  /** Matched attributes / screening hits the provider returned. */
  details: Record<string, unknown>;
  errorMessage?: string;
}

export interface VerificationProvider {
  readonly name: string;
  verifyBusiness(request: BusinessVerificationRequest): Promise<ProviderResult>;
  verifyIdentity(request: IdentityVerificationRequest): Promise<ProviderResult>;
  verifyBankAccount(request: BankAccountVerificationRequest): Promise<ProviderResult>;
}

export const VERIFICATION_PROVIDER = Symbol('VERIFICATION_PROVIDER');
