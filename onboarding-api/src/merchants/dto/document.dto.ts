import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export const DOCUMENT_TYPES = [
  'business_license',
  'articles_of_incorporation',
  'bank_statement',
  'tax_document',
  'government_id',
  'passport',
  'drivers_license',
  'proof_of_address',
] as const;

export const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export class UploadDocumentDto {
  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES)
  document_type!: (typeof DOCUMENT_TYPES)[number];

  @ApiProperty({ example: 'business-license.pdf' })
  @IsString()
  file_name!: string;

  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES })
  @IsIn(ALLOWED_CONTENT_TYPES)
  content_type!: (typeof ALLOWED_CONTENT_TYPES)[number];

  @ApiProperty({ description: 'Base64-encoded file contents (max 10 MB decoded)' })
  @IsBase64()
  file_content!: string;

  @ApiPropertyOptional({ description: 'Attach an identity document to a specific owner' })
  @IsOptional()
  @IsString()
  owner_id?: string;

  @ApiPropertyOptional({ example: '2030-01-01' })
  @IsOptional()
  @IsDateString()
  expires_at?: string;
}
