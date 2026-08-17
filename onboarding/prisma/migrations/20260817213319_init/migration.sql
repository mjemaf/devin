-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('individual', 'company');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('pending', 'under_review', 'approved', 'declined', 'suspended', 'active');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('checking', 'savings');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('instant', 'micro_deposits', 'document_upload', 'biometric', 'database_check');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high', 'prohibited');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('onboarding', 'ongoing');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('approved', 'declined', 'manual_review');

-- CreateEnum
CREATE TYPE "UnderwritingType" AS ENUM ('automated', 'manual');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "integration" TEXT NOT NULL DEFAULT 'direct_api',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'operator',
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "partner_id" UUID NOT NULL,
    "business_type" "BusinessType" NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'pending',
    "country" CHAR(2) NOT NULL,
    "business_profile" JSONB NOT NULL,
    "contact" JSONB NOT NULL,
    "address" JSONB,
    "compliance" JSONB NOT NULL,
    "processing_limits" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_steps" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'pending',
    "position" INTEGER NOT NULL,
    "required_actions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onboarding_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owners" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "date_of_birth" DATE NOT NULL,
    "address" JSONB NOT NULL,
    "ownership_percentage" DECIMAL(5,2) NOT NULL,
    "title" TEXT,
    "tax_id_last4" TEXT,
    "is_control_person" BOOLEAN NOT NULL DEFAULT false,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "account_number_last4" VARCHAR(4) NOT NULL,
    "account_number_token" TEXT NOT NULL,
    "routing_number" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "account_holder_name" TEXT NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "verification_method" "VerificationMethod",
    "micro_deposit_amounts" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "owner_id" UUID,
    "document_type" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_attempts" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "verification_type" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "provider" TEXT,
    "subject_id" TEXT,
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
    "public_id" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "factors" JSONB NOT NULL,
    "recommendations" JSONB,
    "assessment_type" "AssessmentType" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "underwriting_decisions" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "decision" "Decision" NOT NULL,
    "reason" TEXT,
    "reason_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "processing_limits" JSONB,
    "pricing_tier" TEXT,
    "underwriting_type" "UnderwritingType" NOT NULL,
    "risk_assessment_id" UUID,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "underwriting_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "partner_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "webhook_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_code" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "merchant_id" UUID,
    "actor_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "changes" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_public_id_key" ON "partners"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_partner_id_idx" ON "api_keys"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_public_id_key" ON "merchants"("public_id");

-- CreateIndex
CREATE INDEX "merchants_partner_id_idx" ON "merchants"("partner_id");

-- CreateIndex
CREATE INDEX "merchants_status_idx" ON "merchants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_steps_merchant_id_name_key" ON "onboarding_steps"("merchant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "owners_public_id_key" ON "owners"("public_id");

-- CreateIndex
CREATE INDEX "owners_merchant_id_idx" ON "owners"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_public_id_key" ON "bank_accounts"("public_id");

-- CreateIndex
CREATE INDEX "bank_accounts_merchant_id_idx" ON "bank_accounts"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_public_id_key" ON "documents"("public_id");

-- CreateIndex
CREATE INDEX "documents_merchant_id_idx" ON "documents"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_attempts_public_id_key" ON "verification_attempts"("public_id");

-- CreateIndex
CREATE INDEX "verification_attempts_merchant_id_idx" ON "verification_attempts"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_assessments_public_id_key" ON "risk_assessments"("public_id");

-- CreateIndex
CREATE INDEX "risk_assessments_merchant_id_idx" ON "risk_assessments"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "underwriting_decisions_public_id_key" ON "underwriting_decisions"("public_id");

-- CreateIndex
CREATE INDEX "underwriting_decisions_merchant_id_idx" ON "underwriting_decisions"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_public_id_key" ON "webhooks"("public_id");

-- CreateIndex
CREATE INDEX "webhooks_partner_id_idx" ON "webhooks"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_public_id_key" ON "webhook_deliveries"("public_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries"("webhook_id");

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
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
