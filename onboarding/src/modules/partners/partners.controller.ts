import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../../common/auth/current-principal.decorator';
import { Principal } from '../../common/auth/principal';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ReqContext, RequestContext } from '../../common/context/request-context';
import { CreateApiKeyDto, CreatePartnerDto } from './dto/partner.dto';
import { PartnersService } from './partners.service';

@ApiTags('partners')
@Controller({ path: 'partners', version: '1' })
@RequireScopes('partners:admin')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Post()
  @ApiOperation({ summary: 'Provision a partner (tenant)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreatePartnerDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.partners.create(principal, dto, context);
  }

  @Get()
  @ApiOperation({ summary: 'List partners' })
  list() {
    return this.partners.list();
  }

  @Post(':partnerId/api-keys')
  @ApiOperation({
    summary: 'Issue a scoped API key',
    description: 'The secret is returned once; only its hash is stored.',
  })
  issueKey(
    @CurrentPrincipal() principal: Principal,
    @Param('partnerId') partnerId: string,
    @Body() dto: CreateApiKeyDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.partners.issueApiKey(principal, partnerId, dto, context);
  }

  @Get(':partnerId/api-keys')
  @ApiOperation({ summary: 'List a partner API keys (metadata only)' })
  listKeys(@Param('partnerId') partnerId: string) {
    return this.partners.listApiKeys(partnerId);
  }

  @Delete('api-keys/:prefix')
  @ApiOperation({ summary: 'Revoke an API key' })
  revokeKey(
    @CurrentPrincipal() principal: Principal,
    @Param('prefix') prefix: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.partners.revokeApiKey(principal, prefix, context);
  }
}
