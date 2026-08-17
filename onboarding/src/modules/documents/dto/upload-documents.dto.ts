import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export const DOCUMENT_TYPES = [
  'government_id',
  'passport',
  'articles_of_incorporation',
  'bank_statement',
  'utility_bill',
  'tax_document',
  'proof_of_address',
] as const;

export const DOCUMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

export class DocumentDto {
  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES as unknown as string[])
  type!: string;

  @ApiPropertyOptional({ description: 'Owner the document belongs to, for KYC documents' })
  @IsOptional()
  @IsString()
  owner_id?: string;

  @ApiProperty({ description: 'Base64-encoded file contents' })
  @IsBase64()
  file!: string;

  @ApiProperty({ example: 'passport.jpg' })
  @IsString()
  filename!: string;

  @ApiProperty({ enum: DOCUMENT_CONTENT_TYPES })
  @IsIn(DOCUMENT_CONTENT_TYPES as unknown as string[])
  content_type!: string;
}

export class UploadDocumentsDto {
  @ApiProperty({ type: [DocumentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DocumentDto)
  documents!: DocumentDto[];
}
