import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { CheckInDto } from './dto/check-in.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  checkIn(@CurrentUser('id') memberId: string, @Body() dto: CheckInDto) {
    return this.attendanceService.checkIn(memberId, dto);
  }

  @Get('history')
  history(@CurrentUser('id') memberId: string) {
    return this.attendanceService.getHistory(memberId);
  }

  @Get('streak')
  streak(@CurrentUser('id') memberId: string) {
    return this.attendanceService.getStreak(memberId);
  }

  @Get('leaderboard')
  leaderboard() {
    return this.attendanceService.getLeaderboard();
  }

  @Get('today')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  todayAttendance() {
    return this.attendanceService.getTodayAttendance();
  }
}
