import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class VerifyBusinessDto {
  @ApiProperty({ example: 'mer_9f2c1a' })
  @IsString()
  merchant_id!: string;

  @ApiPropertyOptional({ enum: ['standard', 'expedited'], default: 'standard' })
  @IsOptional()
  @IsIn(['standard', 'expedited'])
  priority?: 'standard' | 'expedited';
}

export class VerifyIdentityDto {
  @ApiProperty({ example: 'mer_9f2c1a' })
  @IsString()
  merchant_id!: string;

  @ApiProperty({ example: 'owner_31bd77' })
  @IsString()
  owner_id!: string;

  @ApiProperty({ enum: ['document_upload', 'biometric', 'database_check'] })
  @IsIn(['document_upload', 'biometric', 'database_check'])
  verification_method!: 'document_upload' | 'biometric' | 'database_check';

  @ApiProperty({ description: 'Merchant consent to run identity checks' })
  @IsBoolean()
  consent!: boolean;
}

export class VerifyBankAccountDto {
  @ApiProperty({ example: 'mer_9f2c1a' })
  @IsString()
  merchant_id!: string;

  @ApiProperty({ example: 'ba_5cd812' })
  @IsString()
  bank_account_id!: string;

  @ApiProperty({ enum: ['instant', 'micro_deposits'] })
  @IsIn(['instant', 'micro_deposits'])
  verification_method!: 'instant' | 'micro_deposits';
}

export class ConfirmMicroDepositsDto {
  @ApiProperty({ example: 'mer_9f2c1a' })
  @IsString()
  merchant_id!: string;

  @ApiProperty({ example: 'ba_5cd812' })
  @IsString()
  bank_account_id!: string;

  @ApiProperty({ example: [12, 47], description: 'Deposited amounts in cents' })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(99, { each: true })
  amounts!: number[];
}
