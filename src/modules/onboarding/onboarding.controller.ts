import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { TimelineService } from './timeline.service';
import { CreateApplicationDto, UpdateApplicationDto, SubmitApplicationDto } from './dto/create-application.dto';
import { Scopes } from '../../common/guards/auth.guard';
import { Request } from 'express';

/**
 * Onboarding Controller
 * 
 * Manages application lifecycle, requirements, and onboarding sessions
 */
@Controller('v1/applications')
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly timelineService: TimelineService,
  ) {}

  /**
   * Create a new application
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // // @Scopes('onboarding:write')
  async createApplication(@Body() dto: CreateApplicationDto, @Req() req: any) {
    const application = await this.onboardingService.createApplication(
      dto,
      req.user?.sub || 'demo-user',
      req.user?.org_path || 'demo-org',
    );
    return {
      data: application,
    };
  }

  /**
   * Get application by ID
   */
  @Get(':id')
  // @Scopes('onboarding:read')
  async getApplication(@Param('id') id: string, @Req() req: any) {
    const application = await this.onboardingService.getApplication(id, req.user.org_path);
    return {
      data: application,
    };
  }

  /**
   * List applications
   */
  @Get()
  // @Scopes('onboarding:read')
  async listApplications(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Req() req?: any,
  ) {
    const applications = await this.onboardingService.listApplications(
      req.user.org,
      req.user.org_path,
      {
        status,
        limit: limit ? parseInt(limit) : undefined,
        cursor,
      },
    );
    return applications;
  }

  /**
   * Update application
   */
  @Put(':id')
  // @Scopes('onboarding:write')
  async updateApplication(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationDto,
    @Req() req: any,
  ) {
    const application = await this.onboardingService.updateApplication(
      id,
      dto,
      req.user.org_path,
      req.ifMatch,
    );
    return {
      data: application,
    };
  }

  /**
   * Submit application
   */
  @Post(':id/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  // @Scopes('onboarding:write')
  async submitApplication(
    @Param('id') id: string,
    @Body() dto: SubmitApplicationDto,
    @Req() req: any,
  ) {
    const application = await this.onboardingService.submitApplication(id, dto, req.user.org_path);
    return {
      data: application,
    };
  }

  /**
   * Get application timeline
   */
  @Get(':id/timeline')
  // @Scopes('onboarding:read')
  async getTimeline(@Param('id') id: string, @Req() req: any) {
    const timeline = await this.timelineService.getTimeline(id, req.user.org_path);
    return {
      data: timeline,
    };
  }

  /**
   * Get state transition history
   */
  @Get(':id/timeline/state-transitions')
  // @Scopes('onboarding:read')
  async getStateTransitions(@Param('id') id: string, @Req() req: any) {
    const transitions = await this.timelineService.getStateTransitions(id, req.user.org_path);
    return {
      data: transitions,
    };
  }

  /**
   * Get requirement history
   */
  @Get(':id/timeline/requirements')
  // @Scopes('onboarding:read')
  async getRequirementHistory(@Param('id') id: string, @Req() req: any) {
    const history = await this.timelineService.getRequirementHistory(id, req.user.org_path);
    return {
      data: history,
    };
  }

  /**
   * Get document history
   */
  @Get(':id/timeline/documents')
  // @Scopes('onboarding:read')
  async getDocumentHistory(@Param('id') id: string, @Req() req: any) {
    const history = await this.timelineService.getDocumentHistory(id, req.user.org_path);
    return {
      data: history,
    };
  }
}
