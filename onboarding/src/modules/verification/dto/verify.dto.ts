import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';

export const BUSINESS_VERIFICATION_SOURCES = [
  'government_registry',
  'credit_bureau',
  'business_database',
] as const;

export class VerifyBusinessDto {
  @ApiProperty({ example: 'mer_abc123' })
  @IsString()
  merchant_id!: string;

  @ApiPropertyOptional({ enum: BUSINESS_VERIFICATION_SOURCES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(BUSINESS_VERIFICATION_SOURCES as unknown as string[], { each: true })
  verification_sources?: string[];

  @ApiPropertyOptional({ enum: ['standard', 'expedited'] })
  @IsOptional()
  @IsIn(['standard', 'expedited'])
  priority?: 'standard' | 'expedited';
}

export class VerifyIdentityDto {
  @ApiProperty()
  @IsString()
  merchant_id!: string;

  @ApiProperty({ example: 'owner_abc123' })
  @IsString()
  owner_id!: string;

  @ApiPropertyOptional({ enum: ['document_upload', 'biometric', 'database_check'] })
  @IsOptional()
  @IsIn(['document_upload', 'biometric', 'database_check'])
  verification_method?: 'document_upload' | 'biometric' | 'database_check';

  @ApiProperty({ description: 'Explicit consent from the individual is mandatory' })
  @IsBoolean()
  @Equals(true, { message: 'consent must be granted before verifying an individual' })
  consent!: boolean;
}

export class VerifyBankAccountDto {
  @ApiProperty()
  @IsString()
  merchant_id!: string;

  @ApiProperty({ example: 'ba_xyz789' })
  @IsString()
  bank_account_id!: string;

  @ApiPropertyOptional({ enum: ['instant', 'micro_deposits'] })
  @IsOptional()
  @IsIn(['instant', 'micro_deposits'])
  verification_method?: 'instant' | 'micro_deposits';
}
