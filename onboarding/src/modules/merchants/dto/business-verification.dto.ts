import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from './address.dto';

export class BusinessVerificationDto {
  @ApiProperty({ example: 'Acme Corporation' })
  @IsString()
  @Length(2, 255)
  legal_name!: string;

  @ApiPropertyOptional({ example: 'Acme Store' })
  @IsOptional()
  @IsString()
  @Length(2, 255)
  dba_name?: string;

  @ApiProperty({ example: '12-3456789', description: 'Tax identifier; stored masked.' })
  @IsString()
  @Length(4, 32)
  tax_id!: string;

  @ApiPropertyOptional({ example: '123456789' })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  registration_number?: string;

  @ApiPropertyOptional({ example: '2015-06-15' })
  @IsOptional()
  @IsDateString()
  incorporation_date?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsISO31661Alpha2()
  incorporation_country?: string;

  @ApiPropertyOptional({ example: 'DE' })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  incorporation_state?: string;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  business_address!: AddressDto;
}
