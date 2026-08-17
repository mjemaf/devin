import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsISO31661Alpha2,
  IsInt,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @MaxLength(255)
  business_name!: string;

  @ApiPropertyOptional({ example: 'https://acme.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiProperty({ example: '5734', description: 'Merchant Category Code' })
  @Matches(/^\d{4}$/, { message: 'mcc must be a 4-digit merchant category code' })
  mcc!: string;

  @ApiProperty({ example: 50000, description: 'Estimated monthly volume in minor units of the settlement currency' })
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  estimated_monthly_volume!: number;

  @ApiPropertyOptional({ example: ['electronics', 'software'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  products_sold?: string[];
}
