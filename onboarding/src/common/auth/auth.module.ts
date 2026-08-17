import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ApiKeyService } from './api-key.service';
import { AuthGuard } from './auth.guard';
import { SessionTokenService } from './session-token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwtSecret'),
      }),
    }),
  ],
  providers: [ApiKeyService, SessionTokenService, AuthGuard],
  exports: [ApiKeyService, SessionTokenService, AuthGuard],
})
export class AuthModule {}
