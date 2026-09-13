import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { RequirementsService } from './requirements.service';
import { CreateRequirementDto, UpdateRequirementDto } from './dto/requirement.dto';
import { Scopes } from '../../common/guards/auth.guard';

/**
 * Requirements Controller
 * 
 * Manages dynamic requirements for applications
 */
@Controller('v1/applications/:applicationId/requirements')
export class RequirementsController {
  constructor(private readonly requirementsService: RequirementsService) {}

  /**
   * Create a requirement
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // @Scopes('onboarding:write')
  async createRequirement(
    @Param('applicationId') applicationId: string,
    @Body() dto: CreateRequirementDto,
  ) {
    const requirement = await this.requirementsService.createRequirement(applicationId, dto);
    return {
      data: requirement,
    };
  }

  /**
   * Get requirement by ID
   */
  @Get(':id')
  // @Scopes('onboarding:read')
  async getRequirement(@Param('id') id: string) {
    const requirement = await this.requirementsService.getRequirement(id);
    return {
      data: requirement,
    };
  }

  /**
   * List requirements for an application
   */
  @Get()
  // @Scopes('onboarding:read')
  async listRequirements(@Param('applicationId') applicationId: string) {
    const requirements = await this.requirementsService.getApplicationRequirements(applicationId);
    return {
      data: requirements,
    };
  }

  /**
   * Update requirement
   */
  @Put(':id')
  // @Scopes('onboarding:write')
  async updateRequirement(
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    const requirement = await this.requirementsService.updateRequirement(id, dto);
    return {
      data: requirement,
    };
  }

  /**
   * Mark requirement as satisfied
   */
  @Post(':id/satisfy')
  @HttpCode(HttpStatus.OK)
  // @Scopes('onboarding:write')
  async satisfyRequirement(
    @Param('id') id: string,
    @Body() body: { documentId?: string },
  ) {
    const requirement = await this.requirementsService.satisfyRequirement(id, body.documentId);
    return {
      data: requirement,
    };
  }

  /**
   * Waive requirement
   */
  @Post(':id/waive')
  @HttpCode(HttpStatus.OK)
  // @Scopes('underwriting:override')
  async waiveRequirement(
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    const requirement = await this.requirementsService.waiveRequirement(id, body.reason);
    return {
      data: requirement,
    };
  }

  /**
   * Delete requirement
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  // @Scopes('onboarding:write')
  async deleteRequirement(@Param('id') id: string) {
    await this.requirementsService.deleteRequirement(id);
  }
}
