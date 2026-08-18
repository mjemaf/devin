import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBase64,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export const DOCUMENT_TYPES = [
  'government_id',
  'passport',
  'articles_of_incorporation',
  'bank_statement',
  'utility_bill',
  'proof_of_address',
  'tax_document',
  'processing_statement',
] as const;

export const DOCUMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'];

export class DocumentDto {
  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES as unknown as string[])
  type!: string;

  @ApiPropertyOptional({ description: 'Owner this document belongs to, for KYC documents.' })
  @IsOptional()
  @IsString()
  owner_id?: string;

  @ApiProperty({ description: 'Base64-encoded file contents.' })
  @IsBase64()
  file!: string;

  @ApiProperty({ example: 'passport.jpg' })
  @IsString()
  @Length(1, 255)
  filename!: string;

  @ApiProperty({ enum: DOCUMENT_CONTENT_TYPES })
  @IsIn(DOCUMENT_CONTENT_TYPES)
  content_type!: string;

  @ApiPropertyOptional({ description: 'Document expiry, tracked for compliance monitoring.' })
  @IsOptional()
  @IsDateString()
  expires_at?: string;
}

export class UploadDocumentsDto {
  @ApiProperty({ type: [DocumentDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DocumentDto)
  documents!: DocumentDto[];
}
