import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO31661Alpha2,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUrl,
  Matches,
  Min,
} from 'class-validator';
import { BusinessType } from '@prisma/client';

/** Minimum viable application; everything else is collected progressively. */
export class CreateMerchantDto {
  @ApiProperty({ enum: BusinessType })
  @IsEnum(BusinessType)
  business_type!: BusinessType;

  @ApiProperty({ example: 'US', description: 'ISO 3166-1 alpha-2 country of operation' })
  @IsISO31661Alpha2()
  country!: string;

  @ApiProperty({ example: 'merchant@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '+14155550123' })
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 phone number' })
  phone!: string;

  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  business_name!: string;

  @ApiPropertyOptional({ example: 'https://acme.example.com' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  website?: string;

  @ApiProperty({ example: '5734', description: 'Merchant Category Code' })
  @Matches(/^\d{4}$/, { message: 'mcc must be a 4-digit merchant category code' })
  mcc!: string;

  @ApiProperty({ example: 50000, description: 'Estimated monthly card volume in minor-unit-free currency' })
  @IsInt()
  @Min(0)
  estimated_monthly_volume!: number;

  @ApiProperty({ example: ['electronics', 'software'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  products_sold!: string[];
}
