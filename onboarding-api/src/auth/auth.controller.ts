import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from './decorators';
import { TokenRequestDto } from './dto/token-request.dto';

@ApiTags('auth')
@Controller('oauth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('token')
  @ApiOperation({ summary: 'Exchange partner credentials for a short-lived access token' })
  async token(@Body() dto: TokenRequestDto) {
    return this.authService.issueClientCredentialsToken(dto.client_id, dto.client_secret);
  }
}
