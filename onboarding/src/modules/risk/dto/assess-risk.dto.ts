import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssessmentType } from '@prisma/client';
import { ArrayMinSize, IsArray, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { RISK_FACTORS } from '../risk-engine';

export class AssessRiskDto {
  @ApiProperty({ example: 'mer_abc123' })
  @IsString()
  merchant_id!: string;

  @ApiPropertyOptional({ enum: AssessmentType, default: AssessmentType.onboarding })
  @IsOptional()
  @IsEnum(AssessmentType)
  assessment_type?: AssessmentType;

  @ApiPropertyOptional({
    enum: RISK_FACTORS,
    isArray: true,
    description: 'Restricts the response to a subset of factors; scoring always uses all factors.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(RISK_FACTORS, { each: true })
  factors?: string[];
}
