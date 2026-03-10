import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInDto } from './dto/check-in.dto';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async checkIn(memberId: string, dto: CheckInDto) {
    // 1. Validate QR code
    const qr = await this.prisma.gymQrCode.findFirst({
      where: {
        code: dto.qrCode,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
    });
    if (!qr) throw new BadRequestException('Invalid or expired QR code');

    // 2. Check active subscription (direct or duo)
    const activeMembership = await this.prisma.subscriptionMember.findFirst({
      where: {
        memberId,
        subscription: { status: 'ACTIVE', endDate: { gte: new Date() } },
      },
    });
    if (!activeMembership) {
      const failedMember = await this.prisma.user.findUnique({
        where: { id: memberId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayPicture: true,
        },
      });
      this.eventEmitter.emit('check_in.result', {
        type: 'check_in_result',
        member: {
          id: memberId,
          firstName: failedMember?.firstName ?? null,
          lastName: failedMember?.lastName ?? null,
          displayPicture: failedMember?.displayPicture ?? null,
        },
        success: false,
        message: 'No active subscription',
        timestamp: new Date().toISOString(),
      });
      throw new ForbiddenException('No active subscription');
    }

    // 3. Record attendance (idempotent per day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.prisma.attendance.findUnique({
      where: { memberId_checkInDate: { memberId, checkInDate: today } },
    });

    if (existing) {
      const streak = await this.prisma.streak.findUnique({
        where: { memberId },
      });
      const existingMember = await this.prisma.user.findUnique({
        where: { id: memberId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayPicture: true,
        },
      });
      this.eventEmitter.emit('check_in.result', {
        type: 'check_in_result',
        member: {
          id: memberId,
          firstName: existingMember?.firstName ?? null,
          lastName: existingMember?.lastName ?? null,
          displayPicture: existingMember?.displayPicture ?? null,
        },
        success: true,
        message: 'Already checked in today',
        timestamp: new Date().toISOString(),
      });
      return {
        alreadyCheckedIn: true,
        message: 'Already checked in today',
        streak: streak?.currentStreak ?? 0,
      };
    }

    await this.prisma.attendance.create({
      data: { memberId, checkInDate: today },
    });

    // 4. Emit activity event
    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayPicture: true,
      },
    });

    this.eventEmitter.emit('activity.check_in', {
      type: 'check_in',
      description: `${member?.firstName} ${member?.lastName} checked in`,
      timestamp: new Date().toISOString(),
      metadata: { memberId },
    });

    // 5. Update streak
    const streak = await this.updateStreak(memberId, today);

    this.eventEmitter.emit('check_in.result', {
      type: 'check_in_result',
      member: {
        id: memberId,
        firstName: member?.firstName ?? null,
        lastName: member?.lastName ?? null,
        displayPicture: member?.displayPicture ?? null,
      },
      success: true,
      message: 'Check-in successful',
      timestamp: new Date().toISOString(),
    });

    return {
      alreadyCheckedIn: false,
      message: 'Check-in successful',
      streak: streak.currentStreak,
      longestStreak: streak.longestStreak,
    };
  }

  private async updateStreak(memberId: string, today: Date) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const existingStreak = await this.prisma.streak.findUnique({
      where: { memberId },
    });
    let currentStreak = 1;
    let longestStreak = 1;

    if (existingStreak) {
      const lastDate = existingStreak.lastCheckInDate;
      if (lastDate && lastDate.getTime() === yesterday.getTime()) {
        currentStreak = existingStreak.currentStreak + 1;
      }
      longestStreak = Math.max(currentStreak, existingStreak.longestStreak);
    }

    return this.prisma.streak.upsert({
      where: { memberId },
      create: {
        memberId,
        currentStreak,
        longestStreak,
        lastCheckInDate: today,
      },
      update: { currentStreak, longestStreak, lastCheckInDate: today },
    });
  }

  async getHistory(memberId: string) {
    return this.prisma.attendance.findMany({
      where: { memberId },
      orderBy: { checkInDate: 'desc' },
      take: 90,
    });
  }

  async getStreak(memberId: string) {
    return this.prisma.streak.findUnique({ where: { memberId } });
  }

  async getLeaderboard() {
    return this.prisma.streak.findMany({
      orderBy: { currentStreak: 'desc' },
      take: 50,
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async getTodayAttendance() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.prisma.attendance.findMany({
      where: { checkInDate: today },
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }
}
