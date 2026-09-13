import { Injectable, Logger } from '@nestjs/common';

/**
 * Circuit breaker states
 */
enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  successThreshold: number;
  monitoringPeriod: number;
}

/**
 * Circuit breaker
 * 
 * Implements the circuit breaker pattern to prevent cascading failures
 */
@Injectable()
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number = 0;
  private failures: number[] = [];

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig,
  ) {
    this.logger.log(`Circuit breaker initialized for ${name}`, this.config);
  }

  /**
   * Execute action with circuit breaker protection
   */
  async execute<T>(action: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionToHalfOpen();
      } else {
        throw new Error(`Circuit breaker for ${this.name} is OPEN`);
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.successCount++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successCount >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.failures.push(Date.now());

    // Clean up old failures outside monitoring period
    const monitoringPeriodAgo = Date.now() - this.config.monitoringPeriod;
    this.failures = this.failures.filter(t => t > monitoringPeriodAgo);

    // Check if we should open the circuit
    if (this.failures.length >= this.config.failureThreshold) {
      this.transitionToOpen();
    }
  }

  /**
   * Check if we should attempt to reset the circuit
   */
  private shouldAttemptReset(): boolean {
    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    return timeSinceLastFailure >= this.config.recoveryTimeout;
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.logger.warn(`Circuit breaker for ${this.name} opened after ${this.failureCount} failures`);
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successCount = 0;
    this.logger.log(`Circuit breaker for ${this.name} transitioned to HALF_OPEN`);
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.logger.log(`Circuit breaker for ${this.name} closed after successful recovery`);
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Get success count
   */
  getSuccessCount(): number {
    return this.successCount;
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.failures = [];
    this.logger.log(`Circuit breaker for ${this.name} reset`);
  }
}

/**
 * Circuit breaker registry
 * 
 * Manages multiple circuit breakers
 */
@Injectable()
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly logger = new Logger(CircuitBreakerRegistry.name);

  /**
   * Get or create circuit breaker
   */
  get(name: string, config?: CircuitBreakerConfig): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const defaultConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        recoveryTimeout: 60000, // 1 minute
        successThreshold: 2,
        monitoringPeriod: 60000, // 1 minute
      };
      
      const breaker = new CircuitBreaker(name, config || defaultConfig);
      this.breakers.set(name, breaker);
      this.logger.log(`Created circuit breaker for ${name}`);
    }

    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breakers
   */
  getAll(): Map<string, CircuitBreaker> {
    return this.breakers;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
    this.logger.log('All circuit breakers reset');
  }
}
