import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO31661Alpha2, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class AddressDto {
  @ApiProperty({ example: '123 Main St' })
  @IsString()
  @MaxLength(200)
  line1!: string;

  @ApiPropertyOptional({ example: 'Suite 100' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @ApiProperty({ example: 'San Francisco' })
  @IsString()
  @MaxLength(100)
  city!: string;

  @ApiPropertyOptional({ example: 'CA' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiProperty({ example: '94105' })
  @IsString()
  @MaxLength(20)
  postal_code!: string;

  @ApiProperty({ example: 'US' })
  @IsISO31661Alpha2()
  @Length(2, 2)
  country!: string;
}
