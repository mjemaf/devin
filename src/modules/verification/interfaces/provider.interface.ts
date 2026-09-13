import { VerificationRequest, VerificationResponse } from '../types/verification.types';

/**
 * Unified verification provider interface
 * 
 * All verification providers must implement this interface
 */
export interface IVerificationProvider {
  /**
   * Provider name/identifier
   */
  readonly name: string;

  /**
   * Provider type (e.g., 'kyb', 'kyc', 'screening', 'bank')
   */
  readonly type: string;

  /**
   * Supported countries
   */
  readonly supportedCountries: string[];

  /**
   * Priority for provider selection (lower = higher priority)
   */
  readonly priority: number;

  /**
   * Cost per request (for cost-aware routing)
   */
  readonly cost: number;

  /**
   * Maximum latency budget in milliseconds
   */
  readonly maxLatencyMs: number;

  /**
   * Execute verification
   */
  verify(request: VerificationRequest): Promise<VerificationResponse>;

  /**
   * Check if provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get health status
   */
  getHealth(): Promise<ProviderHealth>;
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  errorRate?: number;
  lastError?: string;
  lastErrorAt?: Date;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  name: string;
  type: string;
  apiKey: string;
  apiUrl: string;
  supportedCountries: string[];
  priority: number;
  cost: number;
  maxLatencyMs: number;
  enabled: boolean;
}
