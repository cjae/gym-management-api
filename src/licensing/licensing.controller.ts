import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { LicensingService } from './licensing.service';
import { LicensePlanResponseDto } from './dto/license-plan-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Licensing')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Insufficient role' })
@Controller('licensing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LicensingController {
  constructor(private readonly licensingService: LicensingService) {}

  @Get('plan')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: LicensePlanResponseDto })
  getLicensePlan(): Promise<LicensePlanResponseDto> {
    return this.licensingService.getLicensePlan();
  }
}
