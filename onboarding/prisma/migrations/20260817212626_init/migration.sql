-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('individual', 'company');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('pending', 'under_review', 'approved', 'declined', 'suspended', 'active');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'in_progress', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('checking', 'savings');

-- CreateEnum
CREATE TYPE "UnderwritingDecisionType" AS ENUM ('approved', 'declined', 'manual_review');

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "integration_mode" VARCHAR(30) NOT NULL,
    "branding" JSONB,
    "default_locale" VARCHAR(10) NOT NULL DEFAULT 'en-US',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "prefix" VARCHAR(32) NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "scopes" TEXT[],
    "role" VARCHAR(20) NOT NULL DEFAULT 'operator',
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "partner_id" UUID NOT NULL,
    "business_type" "BusinessType" NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'pending',
    "country" VARCHAR(2) NOT NULL,
    "business_profile" JSONB NOT NULL,
    "contact" JSONB NOT NULL,
    "address" JSONB NOT NULL,
    "compliance" JSONB NOT NULL,
    "processing_limits" JSONB,
    "onboarding" JSONB NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en-US',
    "status_reason" TEXT,
    "activated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_tokens" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owners" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "merchant_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "date_of_birth" DATE NOT NULL,
    "address" JSONB NOT NULL,
    "ownership_percentage" DECIMAL(5,2) NOT NULL,
    "title" VARCHAR(100),
    "national_id_last4" VARCHAR(4),
    "is_control_prong" BOOLEAN NOT NULL DEFAULT false,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "merchant_id" UUID NOT NULL,
    "account_number_last4" VARCHAR(4) NOT NULL,
    "account_number_token" VARCHAR(64) NOT NULL,
    "routing_number" VARCHAR(34) NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "account_holder_name" VARCHAR(255) NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "verification_method" VARCHAR(20),
    "micro_deposits" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "merchant_id" UUID NOT NULL,
    "owner_id" UUID,
    "document_type" VARCHAR(50) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_attempts" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "merchant_id" UUID NOT NULL,
    "verification_type" VARCHAR(50) NOT NULL,
    "subject_reference" VARCHAR(40),
    "status" "VerificationStatus" NOT NULL,
    "provider" VARCHAR(50),
    "request_data" JSONB,
    "response_data" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "verification_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "merchant_id" UUID NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "risk_level" VARCHAR(20) NOT NULL,
    "factors" JSONB NOT NULL,
    "recommendations" JSONB,
    "assessment_type" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "underwriting_decisions" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "merchant_id" UUID NOT NULL,
    "decision" "UnderwritingDecisionType" NOT NULL,
    "reason" TEXT,
    "reason_codes" JSONB,
    "processing_limits" JSONB,
    "pricing_tier" VARCHAR(50),
    "underwriting_type" VARCHAR(20) NOT NULL,
    "risk_assessment_id" UUID,
    "reviewed_by" VARCHAR(255),
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "underwriting_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "partner_id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "events" TEXT[],
    "secret" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "event_id" VARCHAR(40) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_code" INTEGER,
    "error_message" TEXT,
    "next_attempt_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "merchant_id" UUID,
    "actor_id" VARCHAR(255) NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" VARCHAR(64),
    "changes" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_partner_id_idx" ON "api_keys"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_reference_key" ON "merchants"("reference");

-- CreateIndex
CREATE INDEX "merchants_partner_id_idx" ON "merchants"("partner_id");

-- CreateIndex
CREATE INDEX "merchants_status_idx" ON "merchants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_tokens_token_hash_key" ON "onboarding_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "onboarding_tokens_merchant_id_idx" ON "onboarding_tokens"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "owners_reference_key" ON "owners"("reference");

-- CreateIndex
CREATE INDEX "owners_merchant_id_idx" ON "owners"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_reference_key" ON "bank_accounts"("reference");

-- CreateIndex
CREATE INDEX "bank_accounts_merchant_id_idx" ON "bank_accounts"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_reference_key" ON "documents"("reference");

-- CreateIndex
CREATE INDEX "documents_merchant_id_idx" ON "documents"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_attempts_reference_key" ON "verification_attempts"("reference");

-- CreateIndex
CREATE INDEX "verification_attempts_merchant_id_idx" ON "verification_attempts"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_assessments_reference_key" ON "risk_assessments"("reference");

-- CreateIndex
CREATE INDEX "risk_assessments_merchant_id_idx" ON "risk_assessments"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "underwriting_decisions_reference_key" ON "underwriting_decisions"("reference");

-- CreateIndex
CREATE INDEX "underwriting_decisions_merchant_id_idx" ON "underwriting_decisions"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_reference_key" ON "webhooks"("reference");

-- CreateIndex
CREATE INDEX "webhooks_partner_id_idx" ON "webhooks"("partner_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries"("webhook_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_partner_id_key_key" ON "idempotency_keys"("partner_id", "key");

-- CreateIndex
CREATE INDEX "audit_logs_merchant_id_idx" ON "audit_logs"("merchant_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tokens" ADD CONSTRAINT "onboarding_tokens_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owners" ADD CONSTRAINT "owners_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "underwriting_decisions" ADD CONSTRAINT "underwriting_decisions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
