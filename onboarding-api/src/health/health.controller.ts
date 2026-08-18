import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators';
import { listSupportedCountries } from '../compliance/regions';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness and database readiness probe' })
  async health() {
    let database = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unavailable';
    }
    return { status: database === 'ok' ? 'ok' : 'degraded', database, version: 'v1' };
  }

  @Public()
  @Get('supported-countries')
  @ApiOperation({ summary: 'Countries currently available for onboarding' })
  countries() {
    return { data: listSupportedCountries() };
  }
}
