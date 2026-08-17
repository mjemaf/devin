import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { WEBHOOK_EVENTS, WebhookEvent } from '../events';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://partner.example.com/webhooks' })
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  url!: string;

  @ApiProperty({ enum: WEBHOOK_EVENTS, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(WEBHOOK_EVENTS as unknown as string[], { each: true })
  events!: WebhookEvent[];

  @ApiPropertyOptional({
    description: 'Signing secret. Generated when omitted and returned once on creation.',
  })
  @IsOptional()
  @IsString()
  @Length(16, 255)
  secret?: string;
}
