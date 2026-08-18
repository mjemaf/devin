import { Injectable } from '@nestjs/common';
import { validateBankAccount } from '../bank-account-validation';
import {
  BankVerificationInput,
  BankVerificationProvider,
  BusinessVerificationInput,
  BusinessVerificationProvider,
  CheckOutcome,
  IdentityVerificationInput,
  IdentityVerificationProvider,
  ProviderResult,
} from './verification-provider';

/**
 * Deterministic stand-ins for real verification vendors. Behaviour is driven purely by
 * the submitted data so partners can script sandbox scenarios:
 *  - a name containing `sanctioned` fails screening,
 *  - a name containing `mismatch` produces a partial match,
 *  - anything else verifies when the mandatory identifiers are present.
 */
function hasMarker(value: string, marker: string): boolean {
  return value.toLowerCase().includes(marker);
}

function screening(name: string, lists: string[]): Record<string, CheckOutcome> {
  const outcome: CheckOutcome = hasMarker(name, 'sanctioned') ? 'match' : 'no_match';
  return Object.fromEntries(lists.map((list) => [`screening_${list.toLowerCase()}`, outcome]));
}

@Injectable()
export class SandboxBusinessVerificationProvider implements BusinessVerificationProvider {
  readonly name = 'sandbox_business_registry';

  async verify(input: BusinessVerificationInput): Promise<ProviderResult> {
    const screeningChecks = screening(input.legalName, input.screeningLists);
    const registryChecks: Record<string, CheckOutcome> = Object.fromEntries(
      input.registries.map((registry) => [
        `registry_${registry.toLowerCase()}`,
        input.registrationNumber || input.taxId
          ? hasMarker(input.legalName, 'mismatch')
            ? ('partial_match' as CheckOutcome)
            : ('match' as CheckOutcome)
          : ('not_available' as CheckOutcome),
      ]),
    );
    const checks: Record<string, CheckOutcome> = {
      ...registryChecks,
      ...screeningChecks,
      website_reachable: input.website ? 'match' : 'not_available',
    };

    const sanctioned = Object.entries(screeningChecks).some(([, outcome]) => outcome === 'match');
    const registryMatched = Object.values(registryChecks).some((outcome) => outcome === 'match');

    if (sanctioned) {
      return {
        provider: this.name,
        status: 'failed',
        checks,
        matchScore: 0,
        failureReason: 'sanctions_screening_hit',
      };
    }
    if (!registryMatched) {
      return {
        provider: this.name,
        status: 'failed',
        checks,
        matchScore: 35,
        failureReason: 'business_not_found_in_registry',
      };
    }

    const partial = Object.values(registryChecks).some((outcome) => outcome === 'partial_match');
    return {
      provider: this.name,
      status: 'verified',
      checks,
      matchScore: partial ? 72 : 96,
    };
  }
}

@Injectable()
export class SandboxIdentityVerificationProvider implements IdentityVerificationProvider {
  readonly name = 'sandbox_identity_bureau';

  async verify(input: IdentityVerificationInput): Promise<ProviderResult> {
    const fullName = `${input.firstName} ${input.lastName}`;
    const checks: Record<string, CheckOutcome> = {
      ...screening(fullName, input.screeningLists),
      name_dob_match: hasMarker(fullName, 'mismatch') ? 'partial_match' : 'match',
      government_id: input.hasIdentityDocument ? 'match' : 'not_available',
      liveness: input.method === 'biometric' ? 'match' : 'not_available',
    };

    if (Object.entries(checks).some(([key, value]) => key.startsWith('screening_') && value === 'match')) {
      return {
        provider: this.name,
        status: 'failed',
        checks,
        matchScore: 0,
        failureReason: 'sanctions_screening_hit',
      };
    }
    if (input.method === 'document_upload' && !input.hasIdentityDocument) {
      return {
        provider: this.name,
        status: 'failed',
        checks,
        matchScore: 20,
        failureReason: 'government_id_document_missing',
      };
    }

    const partial = checks.name_dob_match === 'partial_match';
    return {
      provider: this.name,
      status: 'verified',
      checks,
      matchScore: partial ? 68 : 94,
    };
  }
}

@Injectable()
export class SandboxBankVerificationProvider implements BankVerificationProvider {
  readonly name = 'sandbox_account_validation_network';

  async verify(input: BankVerificationInput): Promise<ProviderResult> {
    const structural = input.accountNumber
      ? validateBankAccount(input.format, input.routingNumber, input.accountNumber)
      : { valid: input.preValidated, format: input.format, reason: 'account_details_invalid' };
    const checks: Record<string, CheckOutcome> = {
      account_number_format: structural.valid ? 'match' : 'no_match',
      account_holder_name: hasMarker(input.accountHolderName, 'mismatch') ? 'partial_match' : 'match',
      account_status: structural.valid ? 'match' : 'not_available',
    };

    if (!structural.valid) {
      return {
        provider: this.name,
        status: 'failed',
        checks,
        matchScore: 0,
        failureReason: structural.reason ?? 'account_details_invalid',
      };
    }
    if (input.method === 'micro_deposits') {
      // Confirmation arrives when the partner submits the deposited amounts.
      return { provider: this.name, status: 'in_progress', checks, matchScore: 50 };
    }

    return {
      provider: this.name,
      status: 'verified',
      checks,
      matchScore: checks.account_holder_name === 'partial_match' ? 70 : 98,
    };
  }
}
