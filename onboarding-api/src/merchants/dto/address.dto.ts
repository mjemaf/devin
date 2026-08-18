import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO31661Alpha2, IsOptional, IsString, MaxLength } from 'class-validator';

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
  city!: string;

  @ApiPropertyOptional({ example: 'CA' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ example: '94105' })
  @IsString()
  postal_code!: string;

  @ApiProperty({ example: 'US' })
  @IsISO31661Alpha2()
  country!: string;
}
