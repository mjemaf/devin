import { BankAccountFormat } from '../../compliance/regions';

export type CheckOutcome = 'match' | 'partial_match' | 'no_match' | 'not_available';

export interface ProviderResult {
  provider: string;
  status: 'verified' | 'failed' | 'in_progress';
  /** Individual data-source checks, e.g. `{ registry_name: 'match' }`. */
  checks: Record<string, CheckOutcome>;
  /** 0-100 confidence that the subject is who they claim to be. */
  matchScore: number;
  failureReason?: string;
}

export interface BusinessVerificationInput {
  legalName: string;
  taxId?: string;
  registrationNumber?: string;
  country: string;
  registries: string[];
  screeningLists: string[];
  website?: string;
}

export interface IdentityVerificationInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  country: string;
  taxIdLast4?: string;
  method: 'document_upload' | 'biometric' | 'database_check';
  hasIdentityDocument: boolean;
  screeningLists: string[];
}

export interface BankVerificationInput {
  accountHolderName: string;
  routingNumber: string;
  /** Only available while the caller still holds the raw number (i.e. at creation). */
  accountNumber?: string;
  /** Set when the account number passed structural validation on a previous call. */
  preValidated: boolean;
  format: BankAccountFormat;
  method: 'instant' | 'micro_deposits';
}

export interface BusinessVerificationProvider {
  readonly name: string;
  verify(input: BusinessVerificationInput): Promise<ProviderResult>;
}

export interface IdentityVerificationProvider {
  readonly name: string;
  verify(input: IdentityVerificationInput): Promise<ProviderResult>;
}

export interface BankVerificationProvider {
  readonly name: string;
  verify(input: BankVerificationInput): Promise<ProviderResult>;
}

export const BUSINESS_VERIFICATION_PROVIDER = Symbol('BUSINESS_VERIFICATION_PROVIDER');
export const IDENTITY_VERIFICATION_PROVIDER = Symbol('IDENTITY_VERIFICATION_PROVIDER');
export const BANK_VERIFICATION_PROVIDER = Symbol('BANK_VERIFICATION_PROVIDER');
