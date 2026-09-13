import { IsString, IsEnum, IsEmail, IsOptional, IsArray, IsNumber, IsUrl } from 'class-validator';

export enum BusinessType {
  INDIVIDUAL = 'individual',
  COMPANY = 'company',
}

export enum Country {
  US = 'US',
  GB = 'GB',
  CA = 'CA',
  AU = 'AU',
}

export class CreateMerchantDto {
  @IsEnum(BusinessType)
  business_type: BusinessType;

  @IsEnum(Country)
  country: Country;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsString()
  business_name: string;

  @IsUrl()
  @IsOptional()
  website?: string;

  @IsString()
  @IsOptional()
  mcc?: string;

  @IsNumber()
  @IsOptional()
  estimated_monthly_volume?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  products_sold?: string[];
}