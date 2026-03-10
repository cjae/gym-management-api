import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { EntrancesService } from './entrances.service';
import { CreateEntranceDto } from './dto/create-entrance.dto';
import { UpdateEntranceDto } from './dto/update-entrance.dto';
import { EntranceResponseDto } from './dto/entrance-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Entrances')
@ApiBearerAuth()
@Controller('entrances')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class EntrancesController {
  constructor(private readonly entrancesService: EntrancesService) {}

  @Post()
  @ApiCreatedResponse({ type: EntranceResponseDto })
  create(@Body() dto: CreateEntranceDto) {
    return this.entrancesService.create(dto);
  }

  @Get()
  @ApiOkResponse({ type: [EntranceResponseDto] })
  findAll(@Query() query: PaginationQueryDto) {
    return this.entrancesService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOkResponse({ type: EntranceResponseDto })
  @ApiNotFoundResponse({ description: 'Entrance not found' })
  findOne(@Param('id') id: string) {
    return this.entrancesService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: EntranceResponseDto })
  @ApiNotFoundResponse({ description: 'Entrance not found' })
  update(@Param('id') id: string, @Body() dto: UpdateEntranceDto) {
    return this.entrancesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ type: EntranceResponseDto })
  @ApiNotFoundResponse({ description: 'Entrance not found' })
  remove(@Param('id') id: string) {
    return this.entrancesService.remove(id);
  }
}
