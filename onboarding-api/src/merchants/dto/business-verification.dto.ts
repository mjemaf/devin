import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsISO31661Alpha2, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AddressDto } from './address.dto';

export class SubmitBusinessVerificationDto {
  @ApiProperty({ example: 'Acme Corporation' })
  @IsString()
  legal_name!: string;

  @ApiPropertyOptional({ example: 'Acme Store' })
  @IsOptional()
  @IsString()
  dba_name?: string;

  @ApiProperty({ example: '12-3456789', description: 'Stored tokenised; only the last 4 are returned' })
  @IsString()
  tax_id!: string;

  @ApiPropertyOptional({ example: '123456789' })
  @IsOptional()
  @IsString()
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
  incorporation_state?: string;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  business_address!: AddressDto;
}
