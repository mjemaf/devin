import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export const INSTANT_VERIFICATION = 'instant';
export const MICRO_DEPOSIT_VERIFICATION = 'micro_deposits';

export class CreateBankAccountDto {
  @ApiProperty({ example: '000123456789' })
  @Matches(/^\d{4,17}$/, { message: 'account_number must be 4-17 digits' })
  account_number!: string;

  @ApiProperty({ example: '021000021', description: 'Routing/sort/BSB code for the region' })
  @Matches(/^[0-9]{6,12}$/, { message: 'routing_number must be 6-12 digits' })
  routing_number!: string;

  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  account_type!: AccountType;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ example: 'Acme Corporation' })
  @IsString()
  account_holder_name!: string;

  @ApiPropertyOptional({ enum: [INSTANT_VERIFICATION, MICRO_DEPOSIT_VERIFICATION] })
  @IsOptional()
  @IsIn([INSTANT_VERIFICATION, MICRO_DEPOSIT_VERIFICATION])
  verification_method?: typeof INSTANT_VERIFICATION | typeof MICRO_DEPOSIT_VERIFICATION;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}
