import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from './address.dto';

export class CreateOwnerDto {
  @ApiProperty({ example: 'Jane' })
  @IsString()
  first_name!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  last_name!: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: '+14155550123' })
  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 phone number' })
  phone?: string;

  @ApiProperty({ example: '1985-04-12' })
  @IsDateString()
  date_of_birth!: string;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @ApiProperty({ example: 51.5, description: 'Beneficial ownership percentage' })
  @IsNumber()
  @Min(0)
  @Max(100)
  ownership_percentage!: number;

  @ApiPropertyOptional({ example: 'CEO' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: '123-45-6789', description: 'Stored as last 4 only' })
  @IsOptional()
  @IsString()
  tax_id?: string;

  @ApiPropertyOptional({ description: 'Beneficial owner with significant control', default: false })
  @IsOptional()
  @IsBoolean()
  is_control_person?: boolean;
}
