import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class SubmitUnderwritingDto {
  @ApiProperty({ example: 'mer_9f2c1a' })
  @IsString()
  merchant_id!: string;

  @ApiPropertyOptional({ enum: ['automated', 'manual'], default: 'automated' })
  @IsOptional()
  @IsIn(['automated', 'manual'])
  underwriting_type?: 'automated' | 'manual';

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  expedited?: boolean;
}

export class ManualDecisionDto {
  @ApiProperty({ enum: ['approved', 'declined'] })
  @IsIn(['approved', 'declined'])
  decision!: 'approved' | 'declined';

  @ApiProperty({ example: 'Reviewed supporting documents; approved with reduced limits' })
  @IsString()
  @MinLength(8)
  reason!: string;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  daily_limit?: number;

  @ApiPropertyOptional({ example: 250000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthly_limit?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  ticket_size_limit?: number;
}
