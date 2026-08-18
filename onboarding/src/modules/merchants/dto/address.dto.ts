import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO31661Alpha2, IsOptional, IsString, Length } from 'class-validator';

export class AddressDto {
  @ApiProperty({ example: '123 Main St' })
  @IsString()
  @Length(1, 255)
  line1!: string;

  @ApiPropertyOptional({ example: 'Suite 100' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  line2?: string;

  @ApiProperty({ example: 'San Francisco' })
  @IsString()
  @Length(1, 120)
  city!: string;

  @ApiPropertyOptional({ example: 'CA' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  state?: string;

  @ApiProperty({ example: '94105' })
  @IsString()
  @Length(2, 20)
  postal_code!: string;

  @ApiProperty({ example: 'US' })
  @IsISO31661Alpha2()
  country!: string;
}
