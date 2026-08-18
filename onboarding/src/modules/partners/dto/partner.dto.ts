import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PartnerRole, SCOPES, Scope } from '../../../common/auth/principal';

export const INTEGRATION_MODES = ['direct_api', 'embedded_ui', 'white_label', 'marketplace'];

export class CreatePartnerDto {
  @ApiProperty({ example: 'Acme Platforms Inc.' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: INTEGRATION_MODES })
  @IsIn(INTEGRATION_MODES)
  integration_mode!: string;

  @ApiPropertyOptional({
    description: 'White-label customisation: logo_url, primary_color, domain, support_email.',
  })
  @IsOptional()
  @IsObject()
  branding?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'en-US' })
  @IsOptional()
  @IsString()
  default_locale?: string;
}

export class CreateApiKeyDto {
  @ApiProperty({ enum: SCOPES, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(SCOPES, { each: true })
  scopes!: Scope[];

  @ApiPropertyOptional({ enum: ['admin', 'operator', 'viewer'], default: 'operator' })
  @IsOptional()
  @IsIn(['admin', 'operator', 'viewer'])
  role?: PartnerRole;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  livemode?: boolean;
}
