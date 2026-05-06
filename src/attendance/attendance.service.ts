import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { CheckInDto } from './dto/check-in.dto';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class AttendanceService {
  private static readonly DEFAULT_TIMEZONE = 'Africa/Nairobi';
  constructor(
    private prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationsService: NotificationsService,
    private readonly gymSettingsService: GymSettingsService,
  ) {}

  private async getCheckInSettings(): Promise<{
    timezone: string;
    daysRequired: number;
  }> {
    const settings = await this.gymSettingsService.getCachedSettings();
    return {
      timezone: settings?.timezone ?? AttendanceService.DEFAULT_TIMEZONE,
      daysRequired: settings?.streakDaysRequiredPerWeek ?? 4,
    };
  }

  /** Current calendar date in the given timezone as a UTC-midnight Date. */
  private getToday(timezone: string): Date {
    const dateStr = new Date().toLocaleDateString('en-CA', {
      timeZone: timezone,
    });
    return new Date(dateStr + 'T00:00:00Z');
  }

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
        subscription: {
          status: 'ACTIVE',
          nextBillingDate: { gte: new Date() },
        },
      },
      include: {
        subscription: { include: { plan: { select: { isOffPeak: true } } } },
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

    // Check off-peak restriction
    if (activeMembership.subscription.plan.isOffPeak) {
      await this.validateOffPeakWindow(memberId, entranceId);
    }

    // 3. Record attendance (idempotent per day).
    //
    // Race safety: the @@unique([memberId, checkInDate]) on Attendance is the
    // atomic gate. Two concurrent check-ins (e.g., simultaneous scans at two
    // entrances) both attempt tx.attendance.create; the DB serialises them via
    // the unique index. The loser hits P2002 and we short-circuit to the
    // "already checked in today" path WITHOUT touching streak or emitting
    // side-effect events — so streak/milestone updates fire exactly once per
    // day per member.
    const { timezone, daysRequired } = await this.getCheckInSettings();
    const today = this.getToday(timezone);

    let txResult: {
      streak: Awaited<ReturnType<AttendanceService['updateStreak']>>;
      totalCheckIns: number;
      isFirstCheckIn: boolean;
    } | null = null;

    try {
      txResult = await this.prisma.$transaction(async (tx) => {
        // Attendance create is the atomic gate — MUST run before streak writes.
        await tx.attendance.create({
          data: { memberId, checkInDate: today, entranceId },
        });

        const txStreak = await this.updateStreak(
          memberId,
          today,
          daysRequired,
          tx,
        );

        const txTotalCheckIns = await tx.attendance.count({
          where: { memberId },
        });

        return {
          streak: txStreak,
          totalCheckIns: txTotalCheckIns,
          isFirstCheckIn: txTotalCheckIns === 1,
        };
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Lost the race — another concurrent check-in already recorded today's
        // attendance. Return the "already checked in today" shape without
        // re-emitting activity / streak / milestone side effects.
        return this.handleAlreadyCheckedIn(memberId, daysRequired, entranceId);
      }
      throw err;
    }

    const { streak, totalCheckIns, isFirstCheckIn } = txResult;

    // --- Post-commit side effects: only fire for the winning transaction. ---

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

    // 5. Streak nudge: "One more day this week!" (only if they have a streak to keep)
    if (streak.daysThisWeek === daysRequired - 1 && streak.weeklyStreak > 0) {
      this.notificationsService
        .create({
          userId: memberId,
          title: 'Almost there!',
          body: `One more day this week to keep your ${streak.weeklyStreak}-week streak going!`,
          type: NotificationType.STREAK_NUDGE,
          metadata: {
            weeklyStreak: streak.weeklyStreak,
            daysThisWeek: streak.daysThisWeek,
          },
        })
        .catch(() => {}); // Fire and forget
    }

    this.eventEmitter.emit('streak.updated', {
      memberId,
      weeklyStreak: streak.weeklyStreak,
      longestStreak: streak.longestStreak,
      previousLongestStreak: streak.previousLongestStreak,
      daysThisWeek: streak.daysThisWeek,
      previousBestWeek: streak.previousBestWeek,
      totalCheckIns,
      isFirstCheckIn,
    });

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
      daysRequired,
      isFirstCheckIn,
      isNewStreakRecord: streak.longestStreak > streak.previousLongestStreak,
    };
  }

  /**
   * Response path for a check-in that lost the race (P2002) or was scanned a
   * second time the same day. Emits only the "already checked in" result event
   * — does NOT touch streak, does NOT emit activity.check_in or streak.updated,
   * so milestones are not double-awarded and the activity feed is not spammed.
   */
  private async handleAlreadyCheckedIn(
    memberId: string,
    daysRequired: number,
    entranceId?: string,
  ) {
    const [streak, existingMember] = await Promise.all([
      this.prisma.streak.findUnique({ where: { memberId } }),
      this.prisma.user.findUnique({
        where: { id: memberId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayPicture: true,
        },
      }),
    ]);

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
      longestStreak: streak?.longestStreak ?? 0,
      daysThisWeek: streak?.daysThisWeek ?? 0,
      daysRequired,
    };
  }

  private async validateOffPeakWindow(memberId: string, entranceId?: string) {
    const settings = await this.gymSettingsService.getCachedSettings();
    if (!settings || settings.offPeakWindows.length === 0) {
      throw new BadRequestException(
        'Off-peak hours not configured. Contact gym admin.',
      );
    }

    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'long',
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
    const currentMinutes = hour * 60 + minute;

    const weekdayName = parts.find((p) => p.type === 'weekday')!.value;
    const dayOfWeekMap: Record<string, string> = {
      Monday: 'MONDAY',
      Tuesday: 'TUESDAY',
      Wednesday: 'WEDNESDAY',
      Thursday: 'THURSDAY',
      Friday: 'FRIDAY',
      Saturday: 'SATURDAY',
      Sunday: 'SUNDAY',
    };
    const currentDay = dayOfWeekMap[weekdayName];

    const applicableWindows = settings.offPeakWindows.filter(
      (w: { dayOfWeek: string | null }) =>
        w.dayOfWeek === null || w.dayOfWeek === currentDay,
    );

    const isWithinWindow = applicableWindows.some(
      (w: { startTime: string; endTime: string }) => {
        const [sh, sm] = w.startTime.split(':').map(Number);
        const [eh, em] = w.endTime.split(':').map(Number);
        const start = sh * 60 + sm;
        const end = eh * 60 + em;

        if (start <= end) {
          return currentMinutes >= start && currentMinutes < end;
        } else {
          return currentMinutes >= start || currentMinutes < end;
        }
      },
    );

    if (!isWithinWindow) {
      const windowDescriptions = applicableWindows
        .map(
          (w: {
            startTime: string;
            endTime: string;
            dayOfWeek: string | null;
          }) =>
            `${w.startTime}-${w.endTime}${w.dayOfWeek ? ` (${w.dayOfWeek})` : ''}`,
        )
        .join(', ');

      const member = await this.prisma.user.findUnique({
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
          firstName: member?.firstName ?? null,
          lastName: member?.lastName ?? null,
          displayPicture: member?.displayPicture ?? null,
        },
        success: false,
        message: 'Outside off-peak hours',
        entranceId,
        timestamp: new Date().toISOString(),
      });

      throw new BadRequestException(
        `Check-in restricted to off-peak hours: ${windowDescriptions}`,
      );
    }
  }

  private getMondayOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
    const diff = day === 0 ? 6 : day - 1; // days since Monday
    d.setUTCDate(d.getUTCDate() - diff);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private async updateStreak(
    memberId: string,
    today: Date,
    daysRequired: number,
    tx: TxClient = this.prisma,
  ) {
    const currentMonday = this.getMondayOfWeek(today);
    const existingStreak = await tx.streak.findUnique({
      where: { memberId },
    });

    const previousLongestStreak = existingStreak?.longestStreak ?? 0;
    const previousBestWeek = existingStreak?.bestWeek ?? 0;

    // Defence-in-depth idempotency: if the streak row says we already checked
    // in today, return it unchanged. The Attendance unique index should have
    // already caught this upstream; this guard ensures the streak is never
    // double-counted even if somehow invoked twice for the same day.
    if (
      existingStreak?.lastCheckInDate &&
      existingStreak.lastCheckInDate.getTime() === today.getTime()
    ) {
      return { ...existingStreak, previousLongestStreak, previousBestWeek };
    }

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
        const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

        if (diffWeeks === 1 && existingStreak.daysThisWeek >= daysRequired) {
          weeklyStreak = existingStreak.weeklyStreak + 1;
        } else {
          weeklyStreak = 0;
        }
      }
      longestStreak = Math.max(weeklyStreak, existingStreak.longestStreak);
    }

    const bestWeek = Math.max(daysThisWeek, previousBestWeek);

    const streak = await tx.streak.upsert({
      where: { memberId },
      create: {
        memberId,
        weeklyStreak,
        longestStreak,
        daysThisWeek,
        bestWeek,
        weekStart,
        lastCheckInDate: today,
      },
      update: {
        weeklyStreak,
        longestStreak,
        daysThisWeek,
        bestWeek,
        weekStart,
        lastCheckInDate: today,
      },
    });

    return { ...streak, previousLongestStreak, previousBestWeek };
  }

  async getHistory(memberId: string) {
    return this.prisma.attendance.findMany({
      where: { memberId },
      orderBy: { checkInDate: 'desc' },
      take: 90,
    });
  }

  async getStreak(memberId: string) {
    const [streak, { daysRequired }] = await Promise.all([
      this.prisma.streak.findUnique({ where: { memberId } }),
      this.getCheckInSettings(),
    ]);
    return {
      ...(streak ?? {
        memberId,
        weeklyStreak: 0,
        longestStreak: 0,
        daysThisWeek: 0,
        bestWeek: 0,
        weekStart: null,
        lastCheckInDate: null,
      }),
      daysRequired,
    };
  }

  async getLeaderboard(page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.prisma.streak.findMany({
        orderBy: { weeklyStreak: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          member: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayPicture: true,
            },
          },
        },
      }),
      this.prisma.streak.count(),
    ]);
    return { data, total, page, limit };
  }

  async getAvgDaysPerWeek(memberId: string, weeks = 4): Promise<number> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);
    cutoff.setUTCHours(0, 0, 0, 0);

    const rows = await this.prisma.attendance.findMany({
      where: { memberId, checkInDate: { gte: cutoff } },
      select: { checkInDate: true },
    });
    if (rows.length === 0) return 0;

    const distinctDays = new Set(
      rows.map((r) => r.checkInDate.toISOString().slice(0, 10)),
    );
    return Math.round(distinctDays.size / weeks);
  }

  async getTodayAttendance(page = 1, limit = 20, search?: string) {
    const { timezone } = await this.getCheckInSettings();
    const today = this.getToday(timezone);
    const where: {
      checkInDate: Date;
      member?: {
        OR: { firstName?: object; lastName?: object; email?: object }[];
      };
    } = { checkInDate: today };

    if (search) {
      where.member = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
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
