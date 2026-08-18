import { BankAccount, Document, Merchant, Owner } from '@prisma/client';
import { parseOnboardingState } from './onboarding-state';

export interface BusinessProfileShape {
  legal_name?: string;
  dba_name?: string;
  tax_id_last4?: string;
  registration_number?: string;
  incorporation_date?: string;
  incorporation_country?: string;
  incorporation_state?: string;
  mcc?: string;
  website?: string;
  estimated_monthly_volume?: number;
  products_sold?: string[];
}

export function serializeMerchant(merchant: Merchant) {
  return {
    id: merchant.reference,
    business_type: merchant.businessType,
    status: merchant.status,
    country: merchant.country,
    locale: merchant.locale,
    business_profile: merchant.businessProfile as BusinessProfileShape,
    contact: merchant.contact,
    address: merchant.address,
    compliance: merchant.compliance,
    processing_limits: merchant.processingLimits,
    status_reason: merchant.statusReason,
    onboarding: parseOnboardingState(merchant.onboarding),
    activated_at: merchant.activatedAt,
    created_at: merchant.createdAt,
    updated_at: merchant.updatedAt,
  };
}

export function serializeOwner(owner: Owner) {
  return {
    id: owner.reference,
    first_name: owner.firstName,
    last_name: owner.lastName,
    email: owner.email,
    phone: owner.phone,
    date_of_birth: owner.dateOfBirth.toISOString().slice(0, 10),
    address: owner.address,
    ownership_percentage: Number(owner.ownershipPercentage),
    title: owner.title,
    national_id_last4: owner.nationalIdLast4,
    is_control_prong: owner.isControlProng,
    verification_status: owner.verificationStatus,
    created_at: owner.createdAt,
  };
}

export function serializeBankAccount(account: BankAccount) {
  return {
    id: account.reference,
    account_number_last4: account.accountNumberLast4,
    // Bank identifiers are masked like the account number; the full value stays internal
    // and is only passed to verification providers.
    routing_number_last4: account.routingNumber.replace(/\W/g, '').slice(-4),
    account_type: account.accountType,
    currency: account.currency,
    country: account.country,
    account_holder_name: account.accountHolderName,
    verification_status: account.verificationStatus,
    verification_method: account.verificationMethod,
    is_default: account.isDefault,
    created_at: account.createdAt,
  };
}

export function serializeDocument(document: Document) {
  return {
    id: document.reference,
    type: document.documentType,
    filename: document.fileName,
    content_type: document.contentType,
    file_size: document.fileSize,
    sha256: document.sha256,
    verification_status: document.verificationStatus,
    expires_at: document.expiresAt,
    created_at: document.createdAt,
  };
}
