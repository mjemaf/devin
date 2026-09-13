import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { OAuth21Strategy } from '../../common/strategies/oauth-2-1.strategy';
import { JwtValidationService } from '../../common/services/jwt-validation.service';
import { TokenRevocationService } from '../../common/services/token-revocation.service';
import { ScopeValidationService } from '../../common/services/scope-validation.service';
import { ApiKeyService } from '../../common/services/api-key.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService, 
    JwtStrategy, 
    ApiKeyStrategy, 
    OAuth21Strategy,
    JwtValidationService,
    TokenRevocationService,
    ScopeValidationService,
    ApiKeyService,
  ],
  exports: [AuthService, JwtValidationService, TokenRevocationService, ScopeValidationService, ApiKeyService],
})
export class AuthModule {}