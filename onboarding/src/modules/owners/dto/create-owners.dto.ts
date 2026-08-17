import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from '../../merchants/dto/address.dto';

export class OwnerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  first_name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  last_name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @ApiProperty({ example: '1980-05-15' })
  @IsDateString()
  date_of_birth!: string;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @ApiProperty({ example: 75 })
  @IsNumber()
  @Min(0)
  @Max(100)
  ownership_percentage!: number;

  @ApiPropertyOptional({ example: 'CEO' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ example: '1234', description: 'Last 4 of the national tax id' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  tax_id_last4?: string;

  @ApiPropertyOptional({ description: 'Marks the individual with significant control (FinCEN/FCA)' })
  @IsOptional()
  @IsBoolean()
  is_control_person?: boolean;
}

export class CreateOwnersDto {
  @ApiProperty({ type: [OwnerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => OwnerDto)
  owners!: OwnerDto[];
}
