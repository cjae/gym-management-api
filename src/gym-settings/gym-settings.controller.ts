import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { GymSettingsService } from './gym-settings.service';
import { UpsertGymSettingsDto } from './dto/upsert-gym-settings.dto';
import { CreateOffPeakWindowDto } from './dto/create-off-peak-window.dto';
import { GymSettingsResponseDto } from './dto/gym-settings-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Gym Settings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ description: 'Insufficient role' })
@Controller('gym-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GymSettingsController {
  constructor(private readonly gymSettingsService: GymSettingsService) {}

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: GymSettingsResponseDto })
  @ApiNotFoundResponse({ description: 'Gym settings not configured' })
  getSettings() {
    return this.gymSettingsService.getSettings();
  }

  @Put()
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ type: GymSettingsResponseDto })
  upsert(@Body() dto: UpsertGymSettingsDto) {
    return this.gymSettingsService.upsert(dto);
  }

  @Post('off-peak-windows')
  @Roles('SUPER_ADMIN')
  @ApiCreatedResponse({ description: 'Off-peak window created' })
  addOffPeakWindow(@Body() dto: CreateOffPeakWindowDto) {
    return this.gymSettingsService.addOffPeakWindow(dto);
  }

  @Delete('off-peak-windows/:id')
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ description: 'Off-peak window removed' })
  @ApiNotFoundResponse({ description: 'Window not found' })
  removeOffPeakWindow(@Param('id', ParseUUIDPipe) id: string) {
    return this.gymSettingsService.removeOffPeakWindow(id);
  }
}
