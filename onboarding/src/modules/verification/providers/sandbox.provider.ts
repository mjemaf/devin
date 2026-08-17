import { Injectable } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { regionalProfile } from '../../compliance/regional-requirements';
import {
  BankAccountVerificationRequest,
  BusinessVerificationRequest,
  IdentityVerificationRequest,
  ProviderResult,
  VerificationProvider,
} from './verification-provider';

/**
 * Deterministic stand-in for real KYB/KYC/bank vendors. Outcomes are driven by
 * documented magic values so integrations can exercise every branch:
 *  - legal name / holder name containing `FAIL` -> failed
 *  - legal name containing `REVIEW` -> pending (provider needs a human)
 *  - bank account ending `0000` -> failed
 */
@Injectable()
export class SandboxVerificationProvider implements VerificationProvider {
  readonly name = 'sandbox';

  async verifyBusiness(request: BusinessVerificationRequest): Promise<ProviderResult> {
    const region = regionalProfile(request.country);
    if (request.legalName.toUpperCase().includes('FAIL')) {
      return {
        status: VerificationStatus.failed,
        provider: this.name,
        details: { registry: region.businessRegistry, match: 'none' },
        errorMessage: 'Business could not be matched in the registry',
      };
    }
    if (request.legalName.toUpperCase().includes('REVIEW')) {
      return {
        status: VerificationStatus.pending,
        provider: this.name,
        details: { registry: region.businessRegistry, match: 'partial' },
      };
    }
    return {
      status: VerificationStatus.verified,
      provider: this.name,
      details: {
        registry: region.businessRegistry,
        match: 'exact',
        sources: request.sources,
        screenings: region.screenings.map((screening) => ({ screening, hit: false })),
        tax_id_last4: request.taxIdLast4 ?? null,
      },
    };
  }

  async verifyIdentity(request: IdentityVerificationRequest): Promise<ProviderResult> {
    if (request.lastName.toUpperCase().includes('FAIL')) {
      return {
        status: VerificationStatus.failed,
        provider: this.name,
        details: { method: request.method },
        errorMessage: 'Identity could not be verified',
      };
    }
    if (request.method === 'document_upload' && !request.hasIdDocument) {
      return {
        status: VerificationStatus.pending,
        provider: this.name,
        details: { method: request.method, required_action: 'upload_government_id' },
      };
    }
    return {
      status: VerificationStatus.verified,
      provider: this.name,
      details: {
        method: request.method,
        name_match: true,
        dob_match: true,
        watchlist_hit: false,
      },
    };
  }

  async verifyBankAccount(request: BankAccountVerificationRequest): Promise<ProviderResult> {
    const failed =
      request.accountNumberLast4 === '0000' ||
      request.accountHolderName.toUpperCase().includes('FAIL');
    return failed
      ? {
          status: VerificationStatus.failed,
          provider: this.name,
          details: { network: 'sandbox_ach' },
          errorMessage: 'Account could not be validated with the receiving institution',
        }
      : {
          status: VerificationStatus.verified,
          provider: this.name,
          details: {
            network: 'sandbox_ach',
            account_status: 'open',
            name_match: true,
            currency: request.currency,
          },
        };
  }
}
