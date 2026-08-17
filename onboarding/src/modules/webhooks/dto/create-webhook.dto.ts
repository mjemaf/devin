import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { WEBHOOK_EVENTS, WebhookEventType } from '../webhook-events';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://partner.example.com/webhooks' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string;

  @ApiProperty({ enum: WEBHOOK_EVENTS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(WEBHOOK_EVENTS as unknown as string[], { each: true })
  events!: WebhookEventType[];

  @ApiPropertyOptional({
    description: 'Signing secret. Generated when omitted; only returned on creation.',
  })
  @IsOptional()
  @IsString()
  @Length(16, 128)
  secret?: string;
}
