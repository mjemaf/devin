import { Injectable, Logger } from '@nestjs/common';
import { IVerificationProvider, ProviderConfig, ProviderHealth } from '../interfaces/provider.interface';
import { VerificationRequest, VerificationResponse, FindingType, VerificationOutcome, FindingSeverity } from '../types/verification.types';

/**
 * Abstract base class for verification providers
 * 
 * Implements common functionality like health checking, latency tracking, and error handling
 */
@Injectable()
export abstract class BaseVerificationProvider implements IVerificationProvider {
  protected readonly logger = new Logger(this.constructor.name);
  protected config: ProviderConfig;
  protected errorCount = 0;
  protected errorCountWindow: number[] = [];
  protected latencyHistory: number[] = [];

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Provider name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Provider type
   */
  get type(): string {
    return this.config.type;
  }

  /**
   * Supported countries
   */
  get supportedCountries(): string[] {
    return this.config.supportedCountries;
  }

  /**
   * Priority
   */
  get priority(): number {
    return this.config.priority;
  }

  /**
   * Cost per request
   */
  get cost(): number {
    return this.config.cost;
  }

  /**
   * Maximum latency budget
   */
  get maxLatencyMs(): number {
    return this.config.maxLatencyMs;
  }

  /**
   * Execute verification with latency tracking and error handling
   */
  async verify(request: VerificationRequest): Promise<VerificationResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      // Check if provider is enabled
      if (!this.config.enabled) {
        throw new Error(`Provider ${this.name} is disabled`);
      }

      // Check if country is supported
      if (request.data.country && !this.supportedCountries.includes(request.data.country)) {
        throw new Error(`Country ${request.data.country} not supported by ${this.name}`);
      }

      // Execute provider-specific verification
      const response = await this.executeVerification(request, requestId);
      
      // Track latency
      const latency = Date.now() - startTime;
      this.trackLatency(latency);

      // Reset error count on success
      this.resetErrorCount();

      return {
        ...response,
        latencyMs: latency,
        provider: this.name,
        requestId,
      };
    } catch (error) {
      // Track error
      this.trackError(error as Error);

      const latency = Date.now() - startTime;
      this.trackLatency(latency);

      this.logger.error(`Verification failed for ${this.name}`, (error as Error).stack);

      // Return error response
      return {
        outcome: VerificationOutcome.ERROR,
        findings: [{
          type: FindingType.ERROR,
          severity: FindingSeverity.HIGH,
          description: (error as Error).message,
          providerCode: 'ERROR',
        }],
        rawResponse: error,
        normalizedData: {},
        latencyMs: latency,
        cost: 0,
        provider: this.name,
        requestId,
      };
    }
  }

  /**
   * Provider-specific verification implementation
   */
  protected abstract executeVerification(request: VerificationRequest, requestId: string): Promise<Omit<VerificationResponse, 'latencyMs' | 'provider' | 'requestId'>>;

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    const health = await this.getHealth();
    return health.status !== 'unhealthy';
  }

  /**
   * Get provider health status
   */
  async getHealth(): Promise<ProviderHealth> {
    const errorRate = this.calculateErrorRate();
    const avgLatency = this.calculateAverageLatency();

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (errorRate > 0.5) {
      status = 'unhealthy';
    } else if (errorRate > 0.2 || avgLatency > this.maxLatencyMs) {
      status = 'degraded';
    }

    return {
      status,
      latencyMs: avgLatency,
      errorRate,
    };
  }

  /**
   * Track error
   */
  protected trackError(error: Error): void {
    this.errorCount++;
    this.errorCountWindow.push(Date.now());

    // Keep only last 100 errors within 5 minutes
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    this.errorCountWindow = this.errorCountWindow.filter(t => t > fiveMinutesAgo).slice(-100);
  }

  /**
   * Track latency
   */
  protected trackLatency(latencyMs: number): void {
    this.latencyHistory.push(latencyMs);
    
    // Keep only last 100 latencies
    this.latencyHistory = this.latencyHistory.slice(-100);
  }

  /**
   * Reset error count
   */
  protected resetErrorCount(): void {
    this.errorCount = 0;
  }

  /**
   * Calculate error rate
   */
  protected calculateErrorRate(): number {
    if (this.errorCountWindow.length === 0) {
      return 0;
    }
    return this.errorCount / this.errorCountWindow.length;
  }

  /**
   * Calculate average latency
   */
  protected calculateAverageLatency(): number {
    if (this.latencyHistory.length === 0) {
      return 0;
    }
    const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
    return sum / this.latencyHistory.length;
  }

  /**
   * Generate unique request ID
   */
  protected generateRequestId(): string {
    return `${this.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Normalize provider-specific codes to standard finding types
   */
  protected normalizeCode(providerCode: string): FindingType {
    // Default implementation - should be overridden by specific providers
    const code = providerCode.toLowerCase();
    
    if (code.includes('not_found') || code.includes('not found')) {
      return FindingType.PERSON_NOT_FOUND;
    }
    if (code.includes('match')) {
      return FindingType.PERSON_MATCH;
    }
    if (code.includes('deceased') || code.includes('death')) {
      return FindingType.PERSON_DECEASED;
    }
    if (code.includes('sanction') || code.includes('watchlist')) {
      return FindingType.SANCTION_HIT;
    }
    
    return FindingType.UNKNOWN;
  }

  /**
   * Determine finding severity
   */
  protected determineSeverity(findingType: FindingType): FindingSeverity {
    const criticalFindings = [
      FindingType.PERSON_DECEASED,
      FindingType.SANCTION_HIT,
      FindingType.PEP_HIT,
    ];
    
    const highFindings = [
      FindingType.ADDRESS_MISMATCH,
      FindingType.TAX_ID_MISMATCH,
      FindingType.SSN_MISMATCH,
      FindingType.WATCHLIST_HIT,
    ];

    if (criticalFindings.includes(findingType)) {
      return FindingSeverity.CRITICAL;
    }
    if (highFindings.includes(findingType)) {
      return FindingSeverity.HIGH;
    }
    
    return FindingSeverity.MEDIUM;
  }
}
