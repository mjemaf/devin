import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessType } from '@prisma/client';
import { Type } from 'class-transformer';
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
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from './address.dto';

/**
 * Deliberately small: progressive onboarding only asks for what is needed to
 * create the application and compute the merchant's requirement set.
 */
export class CreateMerchantDto {
  @ApiProperty({ enum: ['individual', 'company'] })
  @IsEnum({ individual: 'individual', company: 'company' })
  business_type!: BusinessType;

  @ApiProperty({ example: 'US', description: 'ISO 3166-1 alpha-2 country of the business.' })
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
  @Length(2, 255)
  business_name!: string;

  @ApiPropertyOptional({ example: 'https://acme.example.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiProperty({ example: '5734', description: 'Merchant Category Code.' })
  @Matches(/^[0-9]{4}$/, { message: 'mcc must be a 4 digit merchant category code' })
  mcc!: string;

  @ApiProperty({ example: 50000, description: 'Estimated monthly card volume in minor-unit-free major units.' })
  @IsInt()
  @Min(0)
  estimated_monthly_volume!: number;

  @ApiPropertyOptional({ type: [String], example: ['electronics', 'software'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  products_sold?: string[];

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ example: 'en-US' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  locale?: string;
}
