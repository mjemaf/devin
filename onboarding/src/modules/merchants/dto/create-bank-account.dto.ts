import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsISO31661Alpha2,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty({ example: '123456789', description: 'Full account number or IBAN; tokenised at rest.' })
  @IsString()
  @Length(4, 34)
  account_number!: string;

  @ApiProperty({
    example: '021000021',
    description: 'Routing number, sort code, transit number, BSB or bank code for the country.',
  })
  @IsString()
  @Length(4, 34)
  routing_number!: string;

  @ApiProperty({ enum: ['checking', 'savings'] })
  @IsEnum({ checking: 'checking', savings: 'savings' })
  account_type!: AccountType;

  @ApiProperty({ example: 'USD' })
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3 letter ISO 4217 code' })
  currency!: string;

  @ApiPropertyOptional({ example: 'US', description: 'Defaults to the merchant country.' })
  @IsOptional()
  @IsISO31661Alpha2()
  country?: string;

  @ApiProperty({ example: 'Acme Corporation' })
  @IsString()
  @Length(2, 255)
  account_holder_name!: string;

  @ApiPropertyOptional({ enum: ['instant', 'micro_deposits'] })
  @IsOptional()
  @IsIn(['instant', 'micro_deposits'])
  verification_method?: 'instant' | 'micro_deposits';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @ApiPropertyOptional({ description: 'Optional descriptor shown on settlement reports.' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  statement_descriptor?: string;
}
