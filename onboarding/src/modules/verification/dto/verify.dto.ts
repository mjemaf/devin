import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export const BUSINESS_SOURCES = ['government_registry', 'credit_bureau', 'business_database'];

export class VerifyBusinessDto {
  @ApiProperty({ example: 'mer_abc123' })
  @IsString()
  merchant_id!: string;

  @ApiPropertyOptional({ enum: BUSINESS_SOURCES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(BUSINESS_SOURCES, { each: true })
  verification_sources?: string[];

  @ApiPropertyOptional({ enum: ['standard', 'expedited'], default: 'standard' })
  @IsOptional()
  @IsIn(['standard', 'expedited'])
  priority?: 'standard' | 'expedited';
}

export class VerifyIdentityDto {
  @ApiProperty({ example: 'mer_abc123' })
  @IsString()
  merchant_id!: string;

  @ApiProperty({ example: 'owner_abc123' })
  @IsString()
  owner_id!: string;

  @ApiProperty({ enum: ['document_upload', 'biometric', 'database_check'] })
  @IsIn(['document_upload', 'biometric', 'database_check'])
  verification_method!: 'document_upload' | 'biometric' | 'database_check';

  @ApiProperty({ description: 'Explicit consent from the individual; required by law in every region.' })
  @IsBoolean()
  @Equals(true, { message: 'consent must be true to run identity verification' })
  consent!: boolean;
}

export class VerifyBankAccountDto {
  @ApiProperty({ example: 'mer_abc123' })
  @IsString()
  merchant_id!: string;

  @ApiProperty({ example: 'ba_abc123' })
  @IsString()
  bank_account_id!: string;

  @ApiPropertyOptional({ enum: ['instant', 'micro_deposits'] })
  @IsOptional()
  @IsIn(['instant', 'micro_deposits'])
  verification_method?: 'instant' | 'micro_deposits';
}

export class ConfirmMicroDepositsDto {
  @ApiProperty({ example: 'mer_abc123' })
  @IsString()
  merchant_id!: string;

  @ApiProperty({ example: 'ba_abc123' })
  @IsString()
  bank_account_id!: string;

  @ApiProperty({ example: [11, 27], description: 'Deposit amounts in minor units.' })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  amounts!: number[];
}
