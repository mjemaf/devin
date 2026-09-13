import { IsString, IsEnum, IsNumberString } from 'class-validator';

export enum AccountType {
  CHECKING = 'checking',
  SAVINGS = 'savings',
}

export enum VerificationMethod {
  INSTANT = 'instant',
  MICRO_DEPOSITS = 'micro_deposits',
}

export class CreateBankAccountDto {
  @IsString()
  @IsNumberString()
  account_number: string;

  @IsString()
  @IsNumberString()
  routing_number: string;

  @IsEnum(AccountType)
  account_type: AccountType;

  @IsString()
  currency: string;

  @IsString()
  account_holder_name: string;

  @IsEnum(VerificationMethod)
  verification_method: VerificationMethod;
}