import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckInResponseDto } from './dto/check-in-response.dto';
import { AttendanceResponseDto } from './dto/attendance-response.dto';
import { StreakResponseDto } from './dto/streak-response.dto';
import { LeaderboardEntryResponseDto } from './dto/leaderboard-entry-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Attendance')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @ApiCreatedResponse({ type: CheckInResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid or expired QR code' })
  @ApiForbiddenResponse({ description: 'No active subscription' })
  checkIn(@CurrentUser('id') memberId: string, @Body() dto: CheckInDto) {
    return this.attendanceService.checkIn(memberId, dto);
  }

  @Get('history')
  @ApiOkResponse({ type: [AttendanceResponseDto] })
  history(@CurrentUser('id') memberId: string) {
    return this.attendanceService.getHistory(memberId);
  }

  @Get('streak')
  @ApiOkResponse({ type: StreakResponseDto })
  streak(@CurrentUser('id') memberId: string) {
    return this.attendanceService.getStreak(memberId);
  }

  @Get('leaderboard')
  @ApiOkResponse({ type: [LeaderboardEntryResponseDto] })
  leaderboard() {
    return this.attendanceService.getLeaderboard();
  }

  @Get('today')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: [AttendanceResponseDto] })
  todayAttendance() {
    return this.attendanceService.getTodayAttendance();
  }
}
