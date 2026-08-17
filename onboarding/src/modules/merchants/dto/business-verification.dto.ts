import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from './address.dto';

export class BusinessVerificationDto {
  @ApiProperty({ example: 'Acme Corporation' })
  @IsString()
  @MaxLength(255)
  legal_name!: string;

  @ApiPropertyOptional({ example: 'Acme Store' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  dba_name?: string;

  @ApiProperty({ example: '12-3456789', description: 'Region-specific tax identifier; stored tokenized' })
  @IsString()
  @MaxLength(64)
  tax_id!: string;

  @ApiPropertyOptional({ example: '123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  registration_number?: string;

  @ApiProperty({ example: '2015-06-15' })
  @IsDateString()
  incorporation_date!: string;

  @ApiProperty({ example: 'US' })
  @IsISO31661Alpha2()
  incorporation_country!: string;

  @ApiPropertyOptional({ example: 'DE' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  incorporation_state?: string;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  business_address!: AddressDto;
}
