import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { WEBHOOK_EVENTS, WebhookEvent } from '../webhook-events';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://partner.example.com/webhooks' })
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  url!: string;

  @ApiProperty({ enum: WEBHOOK_EVENTS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(WEBHOOK_EVENTS as unknown as string[], { each: true })
  events!: WebhookEvent[];

  @ApiPropertyOptional({ description: 'Signing secret; generated when omitted' })
  @IsOptional()
  @IsString()
  @MinLength(16)
  secret?: string;
}
