import { Injectable } from '@nestjs/common';
const Redis = require('ioredis');

/**
 * Token Revocation Service
 * 
 * Manages token revocation with Redis deny list
 * 5-second propagation time for revocation
 */
@Injectable()
export class TokenRevocationService {
  private redis: any;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });
  }

  /**
   * Revoke a token
   */
  async revoke(jti: string, exp: number): Promise<void> {
    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await this.redis.setex(`revoked:${jti}`, ttl, '1');
    }
  }

  /**
   * Check if a token is revoked
   */
  async isRevoked(jti: string): Promise<boolean> {
    const exists = await this.redis.exists(`revoked:${jti}`);
    return exists === 1;
  }

  /**
   * Clean up expired revocations
   */
  async cleanup(): Promise<void> {
    // Redis handles TTL automatically, but we can add cleanup logic if needed
  }

  /**
   * Close Redis connection
   */
  async onApplicationShutdown() {
    await this.redis.quit();
  }
}