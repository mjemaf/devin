export type ProviderOutcome = 'verified' | 'failed' | 'in_progress';

export interface ScreeningHit {
  list: string;
  matched_name: string;
  score: number;
}

export interface BusinessCheckRequest {
  merchantReference: string;
  country: string;
  legalName: string;
  dbaName?: string;
  registrationNumber?: string;
  taxIdLast4?: string;
  incorporationDate?: string;
  address: Record<string, unknown>;
  mcc: string;
  website?: string;
  sources: string[];
  priority: 'standard' | 'expedited';
}

export interface BusinessCheckResult {
  provider: string;
  outcome: ProviderOutcome;
  registryStatus: 'active' | 'inactive' | 'not_found';
  matchedFields: string[];
  mismatchedFields: string[];
  screeningHits: ScreeningHit[];
  failureReason?: string;
}

export interface IdentityCheckRequest {
  ownerReference: string;
  country: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  address: Record<string, unknown>;
  nationalIdLast4?: string;
  method: 'document_upload' | 'biometric' | 'database_check';
  hasIdDocument: boolean;
}

export interface IdentityCheckResult {
  provider: string;
  outcome: ProviderOutcome;
  checks: {
    name_match: boolean;
    dob_match: boolean;
    address_match: boolean;
    national_id_match: boolean;
    liveness?: boolean;
  };
  screeningHits: ScreeningHit[];
  failureReason?: string;
}

export interface BankCheckRequest {
  bankAccountReference: string;
  country: string;
  accountNumberLast4: string;
  routingNumber: string;
  accountHolderName: string;
  merchantLegalName: string;
  method: 'instant' | 'micro_deposits';
}

export interface BankCheckResult {
  provider: string;
  outcome: ProviderOutcome;
  accountHolderMatch: boolean;
  accountStatus: 'open' | 'closed' | 'unknown';
  /** Populated only for micro-deposit flows; amounts are in minor units. */
  microDeposits?: number[];
  failureReason?: string;
}

/** Provider-agnostic seam so an implementation can be swapped per region or vendor. */
export interface BusinessVerificationProvider {
  readonly name: string;
  verifyBusiness(request: BusinessCheckRequest): Promise<BusinessCheckResult>;
}

export interface IdentityVerificationProvider {
  readonly name: string;
  verifyIdentity(request: IdentityCheckRequest): Promise<IdentityCheckResult>;
}

export interface BankVerificationProvider {
  readonly name: string;
  verifyBankAccount(request: BankCheckRequest): Promise<BankCheckResult>;
}

export const BUSINESS_PROVIDER = Symbol('BUSINESS_PROVIDER');
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
export const BANK_PROVIDER = Symbol('BANK_PROVIDER');
