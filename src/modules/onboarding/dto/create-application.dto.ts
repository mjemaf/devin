import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDate, ValidateNested, IsObject, IsBoolean, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Create Application DTO
 * 
 * Validates application creation requests
 */
export class CreateApplicationDto {
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @IsString()
  @IsNotEmpty()
  merchantName: string;

  @IsString()
  @IsOptional()
  merchantLegalName?: string;

  @IsString()
  @IsOptional()
  merchantTaxId?: string;

  @IsString()
  @IsOptional()
  merchantPhone?: string;

  @IsString()
  @IsOptional()
  merchantEmail?: string;

  @IsString()
  @IsOptional()
  merchantWebsite?: string;

  @IsString()
  @IsEnum(['retail', 'ecommerce', 'restaurant', 'professional_services', 'healthcare', 'other'])
  @IsOptional()
  merchantCategory?: string;

  @IsString()
  @IsOptional()
  merchantSubcategory?: string;

  @IsObject()
  @IsOptional()
  merchantAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };

  @IsObject()
  @IsOptional()
  processingInfo?: {
    monthlyVolume?: number;
    averageTicket?: number;
    highTicket?: number;
    currency?: string;
  };

  @IsString()
  @IsOptional()
  applicantFirstName?: string;

  @IsString()
  @IsOptional()
  applicantLastName?: string;

  @IsString()
  @IsOptional()
  applicantEmail?: string;

  @IsString()
  @IsOptional()
  applicantPhone?: string;

  @IsString()
  @IsOptional()
  applicantTitle?: string;

  @IsString()
  @IsOptional()
  applicationType?: string;

  @IsString()
  @IsOptional()
  referralCode?: string;

  @IsBoolean()
  @IsOptional()
  termsAccepted?: boolean;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  termsAcceptedAt?: Date;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  documentIds?: string[];
}

/**
 * Update Application DTO
 * 
 * Validates application update requests
 */
export class UpdateApplicationDto {
  @IsString()
  @IsOptional()
  merchantName?: string;

  @IsString()
  @IsOptional()
  merchantLegalName?: string;

  @IsString()
  @IsOptional()
  merchantTaxId?: string;

  @IsString()
  @IsOptional()
  merchantPhone?: string;

  @IsString()
  @IsOptional()
  merchantEmail?: string;

  @IsString()
  @IsOptional()
  merchantWebsite?: string;

  @IsString()
  @IsEnum(['retail', 'ecommerce', 'restaurant', 'professional_services', 'healthcare', 'other'])
  @IsOptional()
  merchantCategory?: string;

  @IsString()
  @IsOptional()
  merchantSubcategory?: string;

  @IsObject()
  @IsOptional()
  merchantAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };

  @IsObject()
  @IsOptional()
  processingInfo?: {
    monthlyVolume?: number;
    averageTicket?: number;
    highTicket?: number;
    currency?: string;
  };

  @IsString()
  @IsOptional()
  applicantFirstName?: string;

  @IsString()
  @IsOptional()
  applicantLastName?: string;

  @IsString()
  @IsOptional()
  applicantEmail?: string;

  @IsString()
  @IsOptional()
  applicantPhone?: string;

  @IsString()
  @IsOptional()
  applicantTitle?: string;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  documentIds?: string[];
}

/**
 * Submit Application DTO
 * 
 * Validates application submission
 */
export class SubmitApplicationDto {
  @IsBoolean()
  @IsNotEmpty()
  termsAccepted: boolean;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  termsAcceptedAt?: Date;

  @IsString()
  @IsOptional()
  bankAccountId?: string;
}
