import { Injectable, Logger } from '@nestjs/common';
import { IVerificationProvider } from './interfaces/provider.interface';
import { VerificationRequest, VerificationResponse } from './types/verification.types';
import { CircuitBreakerRegistry } from './circuit-breaker/circuit-breaker.service';

/**
 * Reconciliation strategies
 */
export enum ReconciliationStrategy {
  FIRST_MATCH = 'first_match',
  BEST_CONFIDENCE = 'best_confidence',
  CONSENSUSUS = 'consensus',
  ALL_MUST_PASS = 'all_must_pass',
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: string;
  type: string;
  priority: number;
  enabled: boolean;
}

/**
 * Verification cascade configuration
 */
export interface CascadeConfig {
  type: string;
  country: string;
  strategy: ReconciliationStrategy;
  providers: ProviderConfig[];
  cacheTtl?: number;
  maxAttempts?: number;
}

/**
 * Verification cascade service
 * 
 * Manages provider selection, fallback chains, and result reconciliation
 */
@Injectable()
export class VerificationCascadeService {
  private readonly logger = new Logger(VerificationCascadeService.name);
  private readonly providers = new Map<string, IVerificationProvider>();
  private readonly cache = new Map<string, { response: VerificationResponse; expiresAt: number }>();
  private readonly defaultCacheTtl = 300000; // 5 minutes

  constructor(
    private readonly circuitBreakerRegistry: CircuitBreakerRegistry,
  ) {}

  /**
   * Register a provider
   */
  registerProvider(provider: IVerificationProvider): void {
    this.providers.set(provider.name, provider);
    this.logger.log(`Registered verification provider: ${provider.name}`);
  }

  /**
   * Execute verification with cascade
   */
  async executeVerification(request: VerificationRequest, config: CascadeConfig): Promise<VerificationResponse> {
    const cacheKey = this.generateCacheKey(request, config);

    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.log(`Cache hit for ${cacheKey}`);
      return cached;
    }

    // Select providers based on configuration
    const providers = this.selectProviders(config);

    // Execute cascade
    const results: VerificationResponse[] = [];
    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        const circuitBreaker = this.circuitBreakerRegistry.get(provider.name);

        const response = await circuitBreaker.execute(async () => {
          return await provider.verify(request);
        });

        results.push(response);

        // If successful and strategy is first_match, return immediately
        if (config.strategy === ReconciliationStrategy.FIRST_MATCH && response.outcome !== 'error') {
          this.cacheResponse(cacheKey, response, config.cacheTtl);
          return response;
        }
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Provider ${provider.name} failed: ${(error as Error).message}`);
      }
    }

    // Reconcile results
    const reconciled = this.reconcileResults(results, config.strategy);

    // Cache the result
    this.cacheResponse(cacheKey, reconciled, config.cacheTtl);

    return reconciled;
  }

  /**
   * Select providers based on configuration
   */
  private selectProviders(config: CascadeConfig): IVerificationProvider[] {
    const availableProviders: Array<{ provider: IVerificationProvider; config: ProviderConfig }> = [];

    for (const [name, provider] of this.providers.entries()) {
      if (provider.type !== config.type) {
        continue;
      }

      if (!provider.supportedCountries.includes(config.country)) {
        continue;
      }

      const providerConfig = config.providers.find(p => p.name === name);
      if (!providerConfig || !providerConfig.enabled) {
        continue;
      }

      availableProviders.push({ provider, config: providerConfig });
    }

    // Sort by priority (lower = higher priority)
    availableProviders.sort((a, b) => a.config.priority - b.config.priority);

    return availableProviders.map(item => item.provider);
  }

  /**
   * Reconcile results using specified strategy
   */
  private reconcileResults(results: VerificationResponse[], strategy: ReconciliationStrategy): VerificationResponse {
    if (results.length === 0) {
      throw new Error('All verification providers failed');
    }

    switch (strategy) {
      case ReconciliationStrategy.FIRST_MATCH:
        return results[0];

      case ReconciliationStrategy.BEST_CONFIDENCE:
        return results.reduce((best, current) => {
          const bestMaxConfidence = Math.max(...best.findings.map(f => f.confidence || 0));
          const currentMaxConfidence = Math.max(...current.findings.map(f => f.confidence || 0));
          return currentMaxConfidence > bestMaxConfidence ? current : best;
        });

      case ReconciliationStrategy.CONSENSUSUS:
        // Check if all successful providers agree
        const successful = results.filter(r => r.outcome !== 'error');
        if (successful.length === 0) {
          return results[0];
        }
        // Return the most common outcome
        const outcomes = successful.map(r => r.outcome);
        const mostCommon = this.getMostCommon(outcomes);
        return successful.find(r => r.outcome === mostCommon) || successful[0];

      case ReconciliationStrategy.ALL_MUST_PASS:
        // All must succeed, return error if any failed
        const anyError = results.find(r => r.outcome === 'error');
        if (anyError) {
          return anyError;
        }
        // All passed, return combined results
        return this.combineResults(results);

      default:
        return results[0];
    }
  }

  /**
   * Combine results from multiple providers
   */
  private combineResults(results: VerificationResponse[]): VerificationResponse {
    const combined = results[0];
    
    // Merge findings from all providers
    const allFindings = results.flatMap(r => r.findings);
    combined.findings = allFindings;

    // Set outcome based on findings
    const hasCritical = allFindings.some(f => f.severity === 'critical');
    const hasHigh = allFindings.some(f => f.severity === 'high');

    if (hasCritical) {
      combined.outcome = 'rejected' as any;
    } else if (hasHigh) {
      combined.outcome = 'needs_review' as any;
    } else {
      combined.outcome = 'clear' as any;
    }

    return combined;
  }

  /**
   * Get most common value in array
   */
  private getMostCommon<T>(array: T[]): T {
    const counts = new Map<T, number>();
    for (const item of array) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    return Array.from(counts.entries()).reduce((a, b) => b[1] > a[1] ? b : a)[0];
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(request: VerificationRequest, config: CascadeConfig): string {
    const dataHash = JSON.stringify(request.data);
    return `${config.type}:${config.country}:${dataHash}`;
  }

  /**
   * Get from cache
   */
  private getFromCache(key: string): VerificationResponse | null {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return cached.response;
  }

  /**
   * Cache response
   */
  private cacheResponse(key: string, response: VerificationResponse, ttl?: number): void {
    const expiresAt = Date.now() + (ttl || this.defaultCacheTtl);
    this.cache.set(key, { response, expiresAt });
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Verification cache cleared');
  }

  /**
   * Get all registered providers
   */
  getProviders(): IVerificationProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get provider by name
   */
  getProvider(name: string): IVerificationProvider | undefined {
    return this.providers.get(name);
  }
}
