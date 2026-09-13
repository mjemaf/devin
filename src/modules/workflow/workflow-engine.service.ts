import { Injectable, Logger } from '@nestjs/common';

/**
 * Workflow execution status
 */
export enum WorkflowStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMED_OUT = 'timed_out',
}

/**
 * Step execution status
 */
export enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  COMPENSATED = 'compensated',
}

/**
 * Workflow step configuration
 */
export interface WorkflowStep {
  id: string;
  name: string;
  execute: (context: any) => Promise<any>;
  compensate?: (context: any, result: any) => Promise<void>;
  parallel?: boolean;
  dependsOn?: string[];
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
  };
  timeoutMs?: number;
}

/**
 * Workflow configuration
 */
export interface WorkflowConfig {
  id: string;
  name: string;
  steps: WorkflowStep[];
  timeoutMs?: number;
  compensationStrategy?: 'sequential' | 'parallel';
}

/**
 * Workflow execution context
 */
export interface WorkflowContext {
  workflowId: string;
  data: Record<string, any>;
  results: Map<string, any>;
  errors: Map<string, Error>;
  metadata: Record<string, any>;
}

/**
 * Workflow execution result
 */
export interface WorkflowResult {
  workflowId: string;
  status: WorkflowStatus;
  results: Record<string, any>;
  errors: Record<string, Error>;
  completedAt: Date;
  durationMs: number;
}

/**
 * Workflow Engine
 * 
 * Simplified workflow orchestration engine with saga pattern support
 */
@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);
  private readonly workflows = new Map<string, WorkflowConfig>();
  private readonly executions = new Map<string, WorkflowContext>();

  /**
   * Register a workflow
   */
  registerWorkflow(config: WorkflowConfig): void {
    this.workflows.set(config.id, config);
    this.logger.log(`Registered workflow: ${config.name}`);
  }

  /**
   * Execute a workflow
   */
  async execute(workflowId: string, initialData: Record<string, any> = {}): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const executionId = `${workflowId}-${Date.now()}`;
    const context: WorkflowContext = {
      workflowId: executionId,
      data: { ...initialData },
      results: new Map(),
      errors: new Map(),
      metadata: {
        startedAt: new Date(),
        workflowName: workflow.name,
      },
    };

    this.executions.set(executionId, context);
    this.logger.log(`Starting workflow execution: ${executionId}`);

    const startTime = Date.now();
    let status = WorkflowStatus.RUNNING;

    try {
      // Execute workflow with timeout
      await this.executeWithTimeout(
        () => this.executeWorkflow(workflow, context),
        workflow.timeoutMs || 300000, // 5 minutes default
      );

      status = WorkflowStatus.COMPLETED;
      this.logger.log(`Workflow completed successfully: ${executionId}`);
    } catch (error) {
      status = WorkflowStatus.FAILED;
      this.logger.error(`Workflow failed: ${executionId}`, (error as Error).stack);

      // Execute compensation
      await this.executeCompensation(workflow, context);
    } finally {
      const duration = Date.now() - startTime;
      const result: WorkflowResult = {
        workflowId: executionId,
        status,
        results: Object.fromEntries(context.results),
        errors: Object.fromEntries(context.errors),
        completedAt: new Date(),
        durationMs: duration,
      };

      this.executions.delete(executionId);
      return result;
    }
  }

  /**
   * Execute workflow steps
   */
  private async executeWorkflow(workflow: WorkflowConfig, context: WorkflowContext): Promise<void> {
    const completedSteps = new Set<string>();
    const pendingSteps = new Set<string>(workflow.steps.map(s => s.id));

    while (pendingSteps.size > 0) {
      // Find steps that can be executed (dependencies satisfied)
      const readySteps = workflow.steps.filter(step => {
        if (completedSteps.has(step.id) || !pendingSteps.has(step.id)) {
          return false;
        }
        if (step.dependsOn) {
          return step.dependsOn.every(dep => completedSteps.has(dep));
        }
        return true;
      });

      if (readySteps.length === 0) {
        throw new Error('Circular dependency detected in workflow');
      }

      // Group by parallel execution
      const parallelGroups = this.groupByParallel(readySteps);

      // Execute each group
      for (const group of parallelGroups) {
        if (group.length === 1) {
          // Sequential execution
          await this.executeStep(group[0], context);
          completedSteps.add(group[0].id);
          pendingSteps.delete(group[0].id);
        } else {
          // Parallel execution
          await Promise.all(
            group.map(async (step) => {
              try {
                await this.executeStep(step, context);
                completedSteps.add(step.id);
              } catch (error) {
                context.errors.set(step.id, error as Error);
              }
            })
          );

          // Check if any failed
          const failedSteps = group.filter(s => context.errors.has(s.id));
          if (failedSteps.length > 0) {
            throw new Error(`Parallel step group failed: ${failedSteps.map(s => s.id).join(', ')}`);
          }

          group.forEach(step => {
            completedSteps.add(step.id);
            pendingSteps.delete(step.id);
          });
        }
      }
    }
  }

  /**
   * Execute a single step with retry
   */
  private async executeStep(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    this.logger.log(`Executing step: ${step.id}`);
    context.metadata.currentStep = step.id;

    const retryPolicy = step.retryPolicy || { maxAttempts: 1, backoffMs: 0 };
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
      try {
        const result = await this.executeWithTimeout(
          () => step.execute(context),
          step.timeoutMs || 30000, // 30 seconds default
        );

        context.results.set(step.id, result);
        this.logger.log(`Step completed: ${step.id}`);
        return;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Step failed (attempt ${attempt}/${retryPolicy.maxAttempts}): ${step.id}`, (error as Error).message);

        if (attempt < retryPolicy.maxAttempts) {
          await this.sleep(retryPolicy.backoffMs * attempt);
        }
      }
    }

    throw lastError || new Error(`Step failed after ${retryPolicy.maxAttempts} attempts: ${step.id}`);
  }

  /**
   * Execute compensation for failed workflow
   */
  private async executeCompensation(workflow: WorkflowConfig, context: WorkflowContext): Promise<void> {
    this.logger.log(`Executing compensation for workflow: ${context.workflowId}`);

    const completedSteps = workflow.steps.filter(step => context.results.has(step.id));
    const compensationSteps = [...completedSteps].reverse(); // Execute in reverse order

    if (workflow.compensationStrategy === 'parallel') {
      // Parallel compensation
      await Promise.all(
        compensationSteps
          .filter(step => step.compensate)
          .map(step => this.compensateStep(step, context))
      );
    } else {
      // Sequential compensation (default)
      for (const step of compensationSteps) {
        if (step.compensate) {
          await this.compensateStep(step, context);
        }
      }
    }

    this.logger.log(`Compensation completed for workflow: ${context.workflowId}`);
  }

  /**
   * Compensate a single step
   */
  private async compensateStep(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    try {
      const result = context.results.get(step.id);
      await step.compensate!(context, result);
      this.logger.log(`Step compensated: ${step.id}`);
    } catch (error) {
      this.logger.error(`Compensation failed for step: ${step.id}`, (error as Error).stack);
      // Continue with other compensations even if one fails
    }
  }

  /**
   * Group steps by parallel execution
   */
  private groupByParallel(steps: WorkflowStep[]): WorkflowStep[][] {
    const groups: WorkflowStep[][] = [];
    const sequential: WorkflowStep[] = [];

    for (const step of steps) {
      if (step.parallel) {
        // If we have sequential steps pending, flush them first
        if (sequential.length > 0) {
          groups.push([...sequential]);
          sequential.length = 0;
        }
        groups.push([step]);
      } else {
        sequential.push(step);
      }
    }

    if (sequential.length > 0) {
      groups.push(sequential);
    }

    return groups;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
      ),
    ]);
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get workflow execution status
   */
  getExecution(workflowId: string): WorkflowContext | undefined {
    return this.executions.get(workflowId);
  }

  /**
   * Cancel a running workflow
   */
  async cancel(workflowId: string): Promise<void> {
    const execution = this.executions.get(workflowId);
    if (execution) {
      execution.metadata.cancelled = true;
      this.logger.log(`Workflow cancelled: ${workflowId}`);
    }
  }

  /**
   * Get all registered workflows
   */
  getWorkflows(): WorkflowConfig[] {
    return Array.from(this.workflows.values());
  }
}
