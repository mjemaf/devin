import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateApiKey(apiKey: string): Promise<any> {
    const partner = await this.prisma.partner.findUnique({
      where: { apiKey },
    });

    if (!partner || !partner.isActive) {
      throw new UnauthorizedException('Invalid API key');
    }

    return partner;
  }

  async validatePartner(email: string, password: string): Promise<any> {
    const partner = await this.prisma.partner.findFirst({
      where: { email },
    });

    if (!partner || !partner.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, partner.apiSecret);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return partner;
  }

  async login(email: string, password: string) {
    const partner = await this.validatePartner(email, password);
    const payload = { sub: partner.id, email: partner.email };
    
    return {
      access_token: this.jwtService.sign(payload),
      partner_id: partner.id,
      expires_in: '7d',
    };
  }

  async generateApiKey(partnerId: string): Promise<string> {
    const apiKey = `pk_${this.generateRandomString(32)}`;
    const apiSecret = await bcrypt.hash(this.generateRandomString(32), 10);

    await this.prisma.partner.update({
      where: { id: partnerId },
      data: { apiKey, apiSecret },
    });

    return apiKey;
  }

  private generateRandomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}