import { Injectable } from '@nestjs/common';
const Redis = require('ioredis');

/**
 * Idempotency Service
 * 
 * Provides Redis-backed idempotency storage with 24-hour TTL
 * Scoped per organization and endpoint
 */
@Injectable()
export class IdempotencyService {
  private redis: any;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });
  }

  /**
   * Store idempotency record
   */
  async store(
    key: string,
    organizationId: string,
    endpoint: string,
    response: any,
    statusCode: number,
    headers: Record<string, string>
  ): Promise<void> {
    const record = {
      key,
      organizationId,
      endpoint,
      response,
      statusCode,
      headers,
      createdAt: new Date().toISOString(),
    };

    const redisKey = this.getRedisKey(organizationId, endpoint, key);
    await this.redis.setex(redisKey, 24 * 60 * 60, JSON.stringify(record)); // 24 hours TTL
  }

  /**
   * Retrieve idempotency record
   */
  async retrieve(
    key: string,
    organizationId: string,
    endpoint: string
  ): Promise<{ response: any; statusCode: number; headers: Record<string, string> } | null> {
    const redisKey = this.getRedisKey(organizationId, endpoint, key);
    const data = await this.redis.get(redisKey);
    
    if (!data) {
      return null;
    }

    const record = JSON.parse(data);
    return {
      response: record.response,
      statusCode: record.statusCode,
      headers: record.headers,
    };
  }

  /**
   * Check if idempotency key is currently being processed
   */
  async isInProgress(
    key: string,
    organizationId: string,
    endpoint: string
  ): Promise<boolean> {
    const redisKey = this.getRedisKey(organizationId, endpoint, key);
    const exists = await this.redis.exists(redisKey);
    return exists === 1;
  }

  /**
   * Mark idempotency key as in progress
   */
  async markInProgress(
    key: string,
    organizationId: string,
    endpoint: string
  ): Promise<void> {
    const redisKey = this.getRedisKey(organizationId, endpoint, key);
    await this.redis.setex(redisKey, 60, JSON.stringify({ status: 'in_progress' })); // 1 minute TTL
  }

  /**
   * Delete idempotency record
   */
  async delete(
    key: string,
    organizationId: string,
    endpoint: string
  ): Promise<void> {
    const redisKey = this.getRedisKey(organizationId, endpoint, key);
    await this.redis.del(redisKey);
  }

  /**
   * Generate Redis key for idempotency record
   */
  private getRedisKey(organizationId: string, endpoint: string, key: string): string {
    return `idempotency:${organizationId}:${endpoint}:${key}`;
  }

  /**
   * Close Redis connection
   */
  async onApplicationShutdown() {
    await this.redis.quit();
  }
}