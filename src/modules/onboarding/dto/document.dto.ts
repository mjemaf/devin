import { IsString, IsEnum, IsOptional, IsDate, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Document Type
 */
export enum DocumentType {
  BUSINESS_LICENSE = 'business_license',
  TAX_RETURN = 'tax_return',
  BANK_STATEMENT = 'bank_statement',
  ID_DOCUMENT = 'id_document',
  PASSPORT = 'passport',
  DRIVER_LICENSE = 'driver_license',
  INSURANCE = 'insurance',
  W9 = 'w9',
  ARTICLES_OF_INCORPORATION = 'articles_of_incorporation',
  VOIDED_CHECK = 'voided_check',
  OTHER = 'other',
}

/**
 * Document Status
 */
export enum DocumentStatus {
  UPLOADING = 'uploading',
  PENDING = 'pending',
  VALIDATING = 'validating',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

/**
 * Upload Document DTO
 */
export class UploadDocumentDto {
  @IsString()
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @IsString()
  @IsOptional()
  documentName?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  contentType?: string;

  @IsNumber()
  @IsOptional()
  fileSize?: number;
}

/**
 * Update Document DTO
 */
export class UpdateDocumentDto {
  @IsString()
  @IsOptional()
  documentName?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(DocumentStatus)
  @IsOptional()
  status?: DocumentStatus;

  @IsString()
  @IsOptional()
  rejectionReason?: string;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  expiresAt?: Date;
}
