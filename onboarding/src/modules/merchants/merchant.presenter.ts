import {
  BankAccount,
  Document,
  Merchant,
  OnboardingStep,
  Owner,
  UnderwritingDecision,
} from '@prisma/client';

export interface MerchantWithRelations extends Merchant {
  steps?: OnboardingStep[];
  owners?: Owner[];
  bankAccounts?: BankAccount[];
  documents?: Document[];
  underwritingDecision?: UnderwritingDecision[];
}

export function presentStep(step: OnboardingStep) {
  return {
    name: step.name,
    status: step.status,
    required_actions: step.requiredActions,
    completed_at: step.completedAt?.toISOString() ?? null,
  };
}

export function presentOwner(owner: Owner) {
  return {
    id: owner.publicId,
    first_name: owner.firstName,
    last_name: owner.lastName,
    email: owner.email,
    phone: owner.phone,
    date_of_birth: owner.dateOfBirth.toISOString().slice(0, 10),
    address: owner.address,
    ownership_percentage: Number(owner.ownershipPercentage),
    title: owner.title,
    is_control_person: owner.isControlPerson,
    verification_status: owner.verificationStatus,
  };
}

export function presentBankAccount(account: BankAccount) {
  return {
    id: account.publicId,
    account_number_last4: account.accountNumberLast4,
    routing_number: account.routingNumber,
    account_type: account.accountType,
    currency: account.currency,
    account_holder_name: account.accountHolderName,
    verification_status: account.verificationStatus,
    verification_method: account.verificationMethod,
    is_default: account.isDefault,
  };
}

export function presentDocument(document: Document) {
  return {
    id: document.publicId,
    type: document.documentType,
    file_name: document.fileName,
    content_type: document.contentType,
    file_size: document.fileSize,
    verification_status: document.verificationStatus,
    expires_at: document.expiresAt?.toISOString() ?? null,
    created_at: document.createdAt.toISOString(),
  };
}

export function presentMerchant(merchant: MerchantWithRelations) {
  return {
    id: merchant.publicId,
    business_type: merchant.businessType,
    status: merchant.status,
    country: merchant.country,
    business_profile: merchant.businessProfile,
    contact: merchant.contact,
    address: merchant.address,
    compliance: merchant.compliance,
    processing_limits: merchant.processingLimits,
    owners: merchant.owners?.map(presentOwner),
    bank_accounts: merchant.bankAccounts?.map(presentBankAccount),
    documents: merchant.documents?.map(presentDocument),
    steps: merchant.steps?.map(presentStep),
    created_at: merchant.createdAt.toISOString(),
    updated_at: merchant.updatedAt.toISOString(),
  };
}
