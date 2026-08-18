import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class AssessRiskDto {
  @ApiProperty({ example: 'mer_abc123' })
  @IsString()
  merchant_id!: string;

  @ApiPropertyOptional({
    enum: ['onboarding', 'ongoing'],
    default: 'onboarding',
    description: 'Ongoing assessments are for periodic monitoring after activation.',
  })
  @IsOptional()
  @IsIn(['onboarding', 'ongoing'])
  assessment_type?: 'onboarding' | 'ongoing';
}
