import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty({ example: '123456789', description: 'Account number or IBAN' })
  @IsString()
  @Length(4, 34)
  account_number!: string;

  @ApiProperty({ example: '021000021', description: 'Routing/sort/transit code; omit for IBAN countries' })
  @IsString()
  @Length(0, 20)
  routing_number!: string;

  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  account_type!: AccountType;

  @ApiProperty({ example: 'USD' })
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code' })
  currency!: string;

  @ApiProperty({ example: 'Acme Corporation' })
  @IsString()
  account_holder_name!: string;

  @ApiProperty({ enum: ['instant', 'micro_deposits'] })
  @IsIn(['instant', 'micro_deposits'])
  verification_method!: 'instant' | 'micro_deposits';

  @ApiPropertyOptional({ description: 'Use this account for settlement', default: true })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}
