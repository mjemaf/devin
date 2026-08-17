import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../common/auth/current-principal.decorator';
import { Principal } from '../../common/auth/principal';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { DocumentsService } from './documents.service';

@ApiTags('compliance')
@Controller({ path: 'documents', version: '1' })
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('expiring')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'Documents expiring within a window (compliance monitoring)' })
  expiring(@CurrentPrincipal() principal: Principal, @Query('within_days') withinDays = '30') {
    return this.documents.expiring(principal, Math.min(Number(withinDays) || 30, 365));
  }
}
