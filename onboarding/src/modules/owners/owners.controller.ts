import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentAuth } from '../../common/auth/auth-context.decorator';
import { AuthContext } from '../../common/auth/auth.types';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { presentOwner } from '../merchants/merchant.presenter';
import { CreateOwnersDto } from './dto/create-owners.dto';
import { OwnersService } from './owners.service';

@ApiTags('owners')
@Controller('merchants/:merchant_id/owners')
export class OwnersController {
  constructor(
    private readonly owners: OwnersService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequireScopes('merchants:write')
  @ApiOperation({ summary: 'Add beneficial owners for KYC' })
  async add(
    @CurrentAuth() auth: AuthContext,
    @Param('merchant_id') merchantId: string,
    @Body() dto: CreateOwnersDto,
  ) {
    const { merchant, owners } = await this.owners.addOwners(auth, merchantId, dto);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'owners.added',
      resourceType: 'owner',
      resourceId: merchant.publicId,
      changes: { count: owners.length },
    });
    return { data: owners.map(presentOwner) };
  }

  @Get()
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'List beneficial owners' })
  async list(@CurrentAuth() auth: AuthContext, @Param('merchant_id') merchantId: string) {
    const owners = await this.owners.list(auth, merchantId);
    return { data: owners.map(presentOwner) };
  }
}
