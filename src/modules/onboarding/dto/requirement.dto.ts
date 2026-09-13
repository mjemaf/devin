import { IsString, IsEnum, IsOptional, IsDate, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Requirement Status
 */
export enum RequirementStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  SATISFIED = 'satisfied',
  WAIVED = 'waived',
  EXEMPTED = 'exempted',
}

/**
 * Requirement Type
 */
export enum RequirementType {
  BUSINESS_INFO = 'business_info',
  OWNER_INFO = 'owner_info',
  BANK_ACCOUNT = 'bank_account',
  TAX_ID = 'tax_id',
  HIPAA_COMPLIANCE = 'hipaa_compliance',
  WEBSITE_URL = 'website_url',
  BUSINESS_LICENSE = 'business_license',
  INSURANCE = 'insurance',
  FINANCIAL_STATEMENTS = 'financial_statements',
  OTHER = 'other',
}

/**
 * Create Requirement DTO
 */
export class CreateRequirementDto {
  @IsString()
  @IsEnum(RequirementType)
  requirementType: RequirementType;

  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  dueDate?: Date;
}

/**
 * Update Requirement DTO
 */
export class UpdateRequirementDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @IsEnum(RequirementStatus)
  @IsOptional()
  status?: RequirementStatus;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  dueDate?: Date;

  @IsString()
  @IsOptional()
  waivedReason?: string;
}
