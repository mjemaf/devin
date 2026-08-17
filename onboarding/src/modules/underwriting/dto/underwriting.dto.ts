import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UnderwritingDecisionType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitUnderwritingDto {
  @ApiProperty({ example: 'mer_abc123' })
  @IsString()
  merchant_id!: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Underwrite before every onboarding step is complete (sandbox and pilots only).',
  })
  @IsOptional()
  @IsBoolean()
  allow_incomplete?: boolean;
}

export class ManualDecisionDto {
  @ApiProperty({ enum: UnderwritingDecisionType })
  @IsEnum(UnderwritingDecisionType)
  decision!: UnderwritingDecisionType;

  @ApiProperty({ example: 'Supporting documentation reviewed and accepted.' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({ example: 'risk.analyst@example.com' })
  @IsString()
  reviewer!: string;
}
