import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class TokenRequestDto {
  @ApiProperty({ example: 'client_credentials' })
  @IsIn(['client_credentials'])
  grant_type!: 'client_credentials';

  @ApiProperty({ example: 'pt_9f2c1a...', description: 'Partner id' })
  @IsString()
  client_id!: string;

  @ApiProperty({ example: 'sk_live_...', description: 'API key acting as the client secret' })
  @IsString()
  client_secret!: string;
}
