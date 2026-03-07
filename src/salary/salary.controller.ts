import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SalaryService } from './salary.service';
import { CreateSalaryRecordDto } from './dto/create-salary-record.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Salary')
@ApiBearerAuth()
@Controller('salary')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class SalaryController {
  constructor(private readonly salaryService: SalaryService) {}

  @Post()
  create(@Body() dto: CreateSalaryRecordDto) {
    return this.salaryService.create(dto);
  }

  @Get()
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  findAll(@Query('month') month?: string, @Query('year') year?: string) {
    const filters: { month?: number; year?: number } = {};
    if (month) filters.month = parseInt(month, 10);
    if (year) filters.year = parseInt(year, 10);
    return this.salaryService.findAll(filters);
  }

  @Get('staff/:staffId')
  findByStaff(@Param('staffId') staffId: string) {
    return this.salaryService.findByStaff(staffId);
  }

  @Patch(':id/pay')
  markAsPaid(@Param('id') id: string) {
    return this.salaryService.markAsPaid(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.salaryService.remove(id);
  }
}
