import { Controller, Get, Post, Put, Body, Param, UseGuards, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CreateSessionDto, UpdateSessionDto } from './dto/session.dto';
import { Scopes } from '../../common/guards/auth.guard';
import { Request } from 'express';

/**
 * Onboarding Sessions Controller
 * 
 * Manages hosted and embedded onboarding sessions
 */
@Controller('v1/onboarding-sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  /**
   * Create a new onboarding session
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // @Scopes('onboarding:write')
  async createSession(@Body() dto: CreateSessionDto, @Req() req: any) {
    const session = await this.sessionsService.createSession(dto, req.user.sub, req.user.org_path);
    return {
      data: session,
    };
  }

  /**
   * Get session by ID
   */
  @Get(':id')
  // @Scopes('onboarding:read')
  async getSession(@Param('id') id: string, @Req() req: any) {
    const session = await this.sessionsService.getSession(id, req.user.org_path);
    return {
      data: session,
    };
  }

  /**
   * Update session
   */
  @Put(':id')
  // @Scopes('onboarding:write')
  async updateSession(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
    @Req() req: any,
  ) {
    const session = await this.sessionsService.updateSession(id, dto, req.user.org_path);
    return {
      data: session,
    };
  }

  /**
   * Start session
   */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  // @Scopes('onboarding:write')
  async startSession(@Param('id') id: string, @Req() req: any) {
    const session = await this.sessionsService.startSession(id, req.user.org_path);
    return {
      data: session,
    };
  }

  /**
   * Complete session
   */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  // @Scopes('onboarding:write')
  async completeSession(@Param('id') id: string, @Req() req: any) {
    const session = await this.sessionsService.completeSession(id, req.user.org_path);
    return {
      data: session,
    };
  }

  /**
   * Abandon session
   */
  @Post(':id/abandon')
  @HttpCode(HttpStatus.OK)
  // @Scopes('onboarding:write')
  async abandonSession(@Param('id') id: string, @Req() req: any) {
    const session = await this.sessionsService.abandonSession(id, req.user.org_path);
    return {
      data: session,
    };
  }

  /**
   * Get hosted session URL
   */
  @Get(':id/hosted-url')
  // @Scopes('onboarding:read')
  async getHostedUrl(@Param('id') id: string, @Req() req: any) {
    const url = await this.sessionsService.getHostedUrl(id, req.user.org_path);
    return {
      data: {
        url,
      },
    };
  }

  /**
   * Get embedded session configuration
   */
  @Get(':id/embedded-config')
  // @Scopes('onboarding:read')
  async getEmbeddedConfig(@Param('id') id: string, @Req() req: any) {
    const config = await this.sessionsService.getEmbeddedConfig(id, req.user.org_path);
    return {
      data: config,
    };
  }

  /**
   * List sessions for an application
   */
  @Get('application/:applicationId')
  // @Scopes('onboarding:read')
  async listSessions(
    @Param('applicationId') applicationId: string,
    @Req() req: any,
  ) {
    const sessions = await this.sessionsService.listSessions(applicationId, req.user.org_path);
    return {
      data: sessions,
    };
  }

  /**
   * Check session expiry
   */
  @Get(':id/expiry')
  // @Scopes('onboarding:read')
  async checkExpiry(@Param('id') id: string) {
    const isExpired = await this.sessionsService.checkSessionExpiry(id);
    return {
      data: {
        isExpired,
      },
    };
  }
}
