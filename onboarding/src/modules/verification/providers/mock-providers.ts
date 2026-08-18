import { Injectable } from '@nestjs/common';
import {
  BankCheckRequest,
  BankCheckResult,
  BankVerificationProvider,
  BusinessCheckRequest,
  BusinessCheckResult,
  BusinessVerificationProvider,
  IdentityCheckRequest,
  IdentityCheckResult,
  IdentityVerificationProvider,
  ScreeningHit,
} from './provider.types';

/**
 * Sandbox triggers. Deterministic inputs let partners exercise every branch of the
 * onboarding state machine without live vendor calls.
 */
export const SANDBOX_TRIGGERS = {
  /** Legal name containing this fails KYB with registry_not_found. */
  businessNotFound: 'TEST_KYB_NOT_FOUND',
  /** Legal name or owner surname containing this returns a sanctions hit. */
  sanctionsHit: 'TEST_SANCTIONS',
  /** Owner national_id_last4 of 0000 fails identity verification. */
  identityFailureIdLast4: '0000',
  /** Routing number of all zeroes reports a closed account. */
  bankClosedRoutingNumber: '000000000',
} as const;

function contains(value: string | undefined, needle: string): boolean {
  return Boolean(value && value.toUpperCase().includes(needle));
}

function sanctionsHits(name: string, lists: string[]): ScreeningHit[] {
  if (!contains(name, SANDBOX_TRIGGERS.sanctionsHit)) {
    return [];
  }
  return lists.slice(0, 1).map((list) => ({ list, matched_name: name, score: 0.94 }));
}

@Injectable()
export class MockBusinessProvider implements BusinessVerificationProvider {
  readonly name = 'mock_business_registry';

  async verifyBusiness(request: BusinessCheckRequest): Promise<BusinessCheckResult> {
    const hits = sanctionsHits(request.legalName, ['OFAC SDN']);

    if (contains(request.legalName, SANDBOX_TRIGGERS.businessNotFound)) {
      return {
        provider: this.name,
        outcome: 'failed',
        registryStatus: 'not_found',
        matchedFields: [],
        mismatchedFields: ['legal_name', 'registration_number'],
        screeningHits: hits,
        failureReason: 'The business could not be located in the government registry.',
      };
    }

    if (hits.length > 0) {
      return {
        provider: this.name,
        outcome: 'failed',
        registryStatus: 'active',
        matchedFields: ['legal_name'],
        mismatchedFields: [],
        screeningHits: hits,
        failureReason: 'Sanctions screening returned a probable match.',
      };
    }

    const matched = ['legal_name', 'address'];
    if (request.registrationNumber) {
      matched.push('registration_number');
    }
    if (request.taxIdLast4) {
      matched.push('tax_id');
    }

    return {
      provider: this.name,
      outcome: 'verified',
      registryStatus: 'active',
      matchedFields: matched,
      mismatchedFields: [],
      screeningHits: [],
    };
  }
}

@Injectable()
export class MockIdentityProvider implements IdentityVerificationProvider {
  readonly name = 'mock_identity_bureau';

  async verifyIdentity(request: IdentityCheckRequest): Promise<IdentityCheckResult> {
    const hits = sanctionsHits(`${request.firstName} ${request.lastName}`, ['OFAC SDN']);
    const idFailed = request.nationalIdLast4 === SANDBOX_TRIGGERS.identityFailureIdLast4;

    if (request.method === 'document_upload' && !request.hasIdDocument) {
      return {
        provider: this.name,
        outcome: 'in_progress',
        checks: {
          name_match: true,
          dob_match: true,
          address_match: true,
          national_id_match: !idFailed,
        },
        screeningHits: hits,
        failureReason: 'Waiting on a government ID document for this owner.',
      };
    }

    if (idFailed || hits.length > 0) {
      return {
        provider: this.name,
        outcome: 'failed',
        checks: {
          name_match: hits.length === 0,
          dob_match: true,
          address_match: true,
          national_id_match: !idFailed,
          ...(request.method === 'biometric' ? { liveness: true } : {}),
        },
        screeningHits: hits,
        failureReason: idFailed
          ? 'The national identifier could not be matched to the individual.'
          : 'Sanctions screening returned a probable match.',
      };
    }

    return {
      provider: this.name,
      outcome: 'verified',
      checks: {
        name_match: true,
        dob_match: true,
        address_match: true,
        national_id_match: true,
        ...(request.method === 'biometric' ? { liveness: true } : {}),
      },
      screeningHits: [],
    };
  }
}

@Injectable()
export class MockBankProvider implements BankVerificationProvider {
  readonly name = 'mock_bank_network';

  async verifyBankAccount(request: BankCheckRequest): Promise<BankCheckResult> {
    if (request.routingNumber.replace(/\D/g, '') === SANDBOX_TRIGGERS.bankClosedRoutingNumber) {
      return {
        provider: this.name,
        outcome: 'failed',
        accountHolderMatch: false,
        accountStatus: 'closed',
        failureReason: 'The bank reported the account as closed.',
      };
    }

    const holderMatch = normalise(request.accountHolderName) === normalise(request.merchantLegalName);

    if (request.method === 'micro_deposits') {
      return {
        provider: this.name,
        outcome: 'in_progress',
        accountHolderMatch: holderMatch,
        accountStatus: 'open',
        // Deterministic in the sandbox so partners can complete the flow unattended.
        microDeposits: [11, 27],
      };
    }

    return {
      provider: this.name,
      outcome: 'verified',
      accountHolderMatch: holderMatch,
      accountStatus: 'open',
    };
  }
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
