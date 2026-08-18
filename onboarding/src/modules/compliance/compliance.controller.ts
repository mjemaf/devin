import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessType } from '@prisma/client';
import { RequireScopes } from '../../common/auth/scopes.decorator';
import { ApiException } from '../../common/errors/api.exception';
import { ComplianceService } from './compliance.service';
import { SUPPORTED_COUNTRIES } from './regional-rules';

@ApiTags('compliance')
@Controller({ path: 'compliance', version: '1' })
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('requirements')
  @RequireScopes('merchants:read')
  @ApiOperation({
    summary: 'Onboarding requirements for a country',
    description:
      'Drives progressive/smart forms: returns the steps, documents and identifiers a ' +
      'merchant in this country and entity type must supply before underwriting.',
  })
  requirements(
    @Query('country') country: string,
    @Query('business_type') businessType: BusinessType = 'company',
  ) {
    if (!country) {
      throw ApiException.validation('invalid_request_parameter', 'country is required', 'country');
    }
    const rules = this.compliance.rulesFor(country);
    return {
      country: rules.country,
      region: rules.region,
      business_type: businessType,
      supported: SUPPORTED_COUNTRIES.includes(rules.country),
      required_steps: this.compliance.requiredSteps(rules.country, businessType),
      required_documents: rules.requiredDocuments,
      registration_number_label: rules.registrationNumberLabel,
      national_id_label: rules.nationalIdLabel,
      bank_identifier_label: rules.bankIdentifierLabel,
      beneficial_owner_threshold: rules.beneficialOwnerThreshold,
      default_currency: rules.defaultCurrency,
      default_locale: rules.defaultLocale,
      regulations: rules.regulations,
      screening_lists: rules.screeningLists,
      data_residency: rules.dataResidency,
    };
  }

  @Get('countries/:country')
  @RequireScopes('merchants:read')
  @ApiOperation({ summary: 'Regional compliance profile for a country' })
  country(@Param('country') country: string) {
    return this.compliance.rulesFor(country);
  }
}
