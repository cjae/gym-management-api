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
    // 1. Parse QR payload — format: "code" or "code:entranceId"
    let qrCode = dto.qrCode;
    let entranceId: string | undefined;

    const delimiterIndex = qrCode.lastIndexOf(':');
    if (delimiterIndex > 0) {
      const candidate = dto.qrCode.substring(delimiterIndex + 1);
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          candidate,
        )
      ) {
        qrCode = dto.qrCode.substring(0, delimiterIndex);
        entranceId = candidate;
      }
    }

    // 2. Validate QR code
    const qr = await this.prisma.gymQrCode.findFirst({
      where: {
        code: qrCode,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
    });
    if (!qr) throw new BadRequestException('Invalid or expired QR code');

    // 3. Validate entrance (if provided)
    if (entranceId) {
      const entrance = await this.prisma.entrance.findUnique({
        where: { id: entranceId },
      });
      if (!entrance || !entrance.isActive) {
        throw new BadRequestException('Invalid or inactive entrance');
      }
    }

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
        entranceId,
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
        entranceId,
        timestamp: new Date().toISOString(),
      });
      return {
        alreadyCheckedIn: true,
        message: 'Already checked in today',
        weeklyStreak: streak?.weeklyStreak ?? 0,
        daysThisWeek: streak?.daysThisWeek ?? 0,
        daysRequired: 4,
      };
    }

    await this.prisma.attendance.create({
      data: { memberId, checkInDate: today, entranceId },
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
      entranceId,
      timestamp: new Date().toISOString(),
    });

    return {
      alreadyCheckedIn: false,
      message: 'Check-in successful',
      weeklyStreak: streak.weeklyStreak,
      longestStreak: streak.longestStreak,
      daysThisWeek: streak.daysThisWeek,
      daysRequired: 4,
    };
  }

  private getMondayOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun, 1=Mon, ...
    const diff = day === 0 ? 6 : day - 1; // days since Monday
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private async updateStreak(memberId: string, today: Date) {
    const currentMonday = this.getMondayOfWeek(today);
    const existingStreak = await this.prisma.streak.findUnique({
      where: { memberId },
    });

    let weeklyStreak = 0;
    let longestStreak = 0;
    let daysThisWeek = 1;
    const weekStart = currentMonday;

    if (existingStreak) {
      const prevWeekStart = existingStreak.weekStart;
      const isSameWeek = prevWeekStart.getTime() === currentMonday.getTime();

      if (isSameWeek) {
        daysThisWeek = existingStreak.daysThisWeek + 1;
        weeklyStreak = existingStreak.weeklyStreak;
      } else {
        const diffMs = currentMonday.getTime() - prevWeekStart.getTime();
        const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));

        if (diffWeeks === 1 && existingStreak.daysThisWeek >= 4) {
          weeklyStreak = existingStreak.weeklyStreak + 1;
        } else {
          weeklyStreak = 0;
        }
      }
      longestStreak = Math.max(weeklyStreak, existingStreak.longestStreak);
    }

    return this.prisma.streak.upsert({
      where: { memberId },
      create: {
        memberId,
        weeklyStreak,
        longestStreak,
        daysThisWeek,
        weekStart,
      },
      update: {
        weeklyStreak,
        longestStreak,
        daysThisWeek,
        weekStart,
        lastCheckInDate: today,
      },
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

  async getLeaderboard(page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.prisma.streak.findMany({
        orderBy: { weeklyStreak: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          member: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.streak.count(),
    ]);
    return { data, total, page, limit };
  }

  async getTodayAttendance(page = 1, limit = 20, search?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const where: any = { checkInDate: today };

    if (search) {
      where.member = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      };
    }
    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: {
          member: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          entrance: {
            select: { id: true, name: true },
          },
        },
        orderBy: { checkInTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.attendance.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
