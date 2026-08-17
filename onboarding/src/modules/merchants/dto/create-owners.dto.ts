import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from './address.dto';

export class OwnerDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  @Length(1, 100)
  first_name!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @Length(1, 100)
  last_name!: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: '+14155550123' })
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

  @ApiProperty({ example: 75, description: 'Beneficial ownership percentage.' })
  @IsNumber()
  @Min(0)
  @Max(100)
  ownership_percentage!: number;

  @ApiPropertyOptional({ example: 'CEO' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  title?: string;

  @ApiPropertyOptional({
    example: '1234',
    description: 'Last 4 of the national identifier (SSN/SIN/NINO). Full values are never accepted.',
  })
  @IsOptional()
  @Matches(/^[0-9]{4}$/)
  national_id_last4?: string;

  @ApiPropertyOptional({
    description: 'Marks the control prong (the individual with significant responsibility).',
  })
  @IsOptional()
  @IsBoolean()
  is_control_prong?: boolean;
}

export class CreateOwnersDto {
  @ApiProperty({ type: [OwnerDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OwnerDto)
  owners!: OwnerDto[];
}
