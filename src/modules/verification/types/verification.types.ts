/**
 * Verification finding types
 * 
 * Normalized finding types across all verification providers
 */
export enum FindingType {
  // KYB findings
  BUSINESS_NOT_FOUND = 'business_not_found',
  BUSINESS_INACTIVE = 'business_inactive',
  BUSINESS_MATCH = 'business_match',
  ADDRESS_MISMATCH = 'address_mismatch',
  TAX_ID_MISMATCH = 'tax_id_mismatch',
  
  // KYC findings
  PERSON_NOT_FOUND = 'person_not_found',
  PERSON_DECEASED = 'person_deceased',
  PERSON_MATCH = 'person_match',
  DOB_MISMATCH = 'dob_mismatch',
  SSN_MISMATCH = 'ssn_mismatch',
  
  // Screening findings
  SANCTION_HIT = 'sanction_hit',
  PEP_HIT = 'pep_hit',
  ADVERSE_MEDIA = 'adverse_media',
  WATCHLIST_HIT = 'watchlist_hit',
  
  // Bank verification findings
  ACCOUNT_NOT_FOUND = 'account_not_found',
  ACCOUNT_CLOSED = 'account_closed',
  ACCOUNT_VALID = 'account_valid',
  NAME_MISMATCH = 'name_mismatch',
  
  // General findings
  TIMEOUT = 'timeout',
  ERROR = 'error',
  UNKNOWN = 'unknown',
}

/**
 * Finding severity levels
 */
export enum FindingSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
}

/**
 * Verification outcome
 */
export enum VerificationOutcome {
  CLEAR = 'clear',
  NEEDS_REVIEW = 'needs_review',
  REJECTED = 'rejected',
  ERROR = 'error',
}

/**
 * Normalized finding interface
 */
export interface NormalizedFinding {
  type: FindingType;
  severity: FindingSeverity;
  description: string;
  providerCode?: string;
  confidence?: number;
  metadata?: Record<string, any>;
}

/**
 * Verification request data
 */
export interface VerificationRequest {
  type: string;
  data: Record<string, any>;
  options?: {
    timeout?: number;
    priority?: 'low' | 'normal' | 'high';
  };
}

/**
 * Verification response data
 */
export interface VerificationResponse {
  outcome: VerificationOutcome;
  findings: NormalizedFinding[];
  rawResponse: any;
  normalizedData: Record<string, any>;
  latencyMs: number;
  cost: number;
  provider: string;
  requestId: string;
}
