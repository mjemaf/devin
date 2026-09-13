import { Controller, Post, Body, Get, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { DiligenceSagaService } from './diligence-saga.service';
import { WorkflowEngine } from './workflow-engine.service';
import { Scopes } from '../../common/guards/auth.guard';

/**
 * Workflow Controller
 * 
 * Manages workflow orchestration and execution
 */
@Controller('v1/workflows')
export class WorkflowController {
  constructor(
    private readonly diligenceSaga: DiligenceSagaService,
    private readonly workflowEngine: WorkflowEngine,
  ) {}

  /**
   * Execute full diligence workflow
   */
  @Post('diligence/full')
  @HttpCode(HttpStatus.ACCEPTED)
  // @Scopes('workflow:execute')
  async executeFullDiligence(@Body() body: {
    merchantId: string;
    personId: string;
    bankAccountId: string;
  }) {
    const result = await this.diligenceSaga.executeFullDiligence(body);
    return {
      data: result,
    };
  }

  /**
   * Execute expedited diligence workflow
   */
  @Post('diligence/expedited')
  @HttpCode(HttpStatus.ACCEPTED)
  // @Scopes('workflow:execute')
  async executeExpeditedDiligence(@Body() body: {
    merchantId: string;
    personId: string;
  }) {
    const result = await this.diligenceSaga.executeExpeditedDiligence(body);
    return {
      data: result,
    };
  }

  /**
   * Get workflow execution status
   */
  @Get('executions/:id')
  // @Scopes('workflow:read')
  async getExecution(@Param('id') id: string) {
    const execution = this.workflowEngine.getExecution(id);
    if (!execution) {
      return {
        data: null,
        message: 'Execution not found or completed',
      };
    }
    return {
      data: execution,
    };
  }

  /**
   * Get all registered workflows
   */
  @Get()
  // @Scopes('workflow:read')
  async getWorkflows() {
    const workflows = this.workflowEngine.getWorkflows();
    return {
      data: workflows,
    };
  }

  /**
   * Cancel a running workflow
   */
  @Post('executions/:id/cancel')
  // @Scopes('workflow:execute')
  async cancelExecution(@Param('id') id: string) {
    await this.workflowEngine.cancel(id);
    return {
      data: { cancelled: true },
    };
  }
}
