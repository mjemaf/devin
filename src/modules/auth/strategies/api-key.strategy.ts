import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-http-bearer';
import { AuthService } from '../auth.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(private authService: AuthService) {
    super();
  }

  async validate(apiKey: string): Promise<any> {
    const partner = await this.authService.validateApiKey(apiKey);
    if (!partner) {
      throw new UnauthorizedException('Invalid API key');
    }
    return partner;
  }
}