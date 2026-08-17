import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UnderwritingType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class SubmitUnderwritingDto {
  @ApiProperty({ example: 'mer_abc123' })
  @IsString()
  merchant_id!: string;

  @ApiPropertyOptional({ enum: UnderwritingType, default: UnderwritingType.automated })
  @IsOptional()
  @IsEnum(UnderwritingType)
  underwriting_type?: UnderwritingType;

  @ApiPropertyOptional({ default: false, description: 'Shortens the manual-review SLA' })
  @IsOptional()
  @IsBoolean()
  expedited?: boolean;
}
