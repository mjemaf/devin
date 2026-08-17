import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ApiKeyService } from './api-key.service';
import { AuthGuard } from './auth.guard';
import { OnboardingTokenService } from './onboarding-token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwtSecret'),
      }),
    }),
  ],
  providers: [ApiKeyService, OnboardingTokenService, AuthGuard],
  exports: [ApiKeyService, OnboardingTokenService, AuthGuard],
})
export class AuthModule {}
