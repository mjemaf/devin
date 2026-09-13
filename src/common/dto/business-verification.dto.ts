import { IsString, IsOptional, IsDate, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class AddressDto {
  @IsString()
  line1: string;

  @IsString()
  @IsOptional()
  line2?: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  postal_code: string;

  @IsString()
  country: string;
}

export class BusinessVerificationDto {
  @IsString()
  legal_name: string;

  @IsString()
  @IsOptional()
  dba_name?: string;

  @IsString()
  tax_id: string;

  @IsString()
  @IsOptional()
  registration_number?: string;

  @IsDate()
  @Type(() => Date)
  incorporation_date: Date;

  @IsString()
  incorporation_country: string;

  @IsString()
  @IsOptional()
  incorporation_state?: string;

  @IsObject()
  business_address: AddressDto;
}