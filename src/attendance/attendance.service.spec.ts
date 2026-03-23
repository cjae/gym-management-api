/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

/** Return Monday 00:00 UTC for the week containing `date`. */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Current calendar date in the given timezone as a UTC-midnight Date. */
function getToday(timezone: string): Date {
  const dateStr = new Date().toLocaleDateString('en-CA', {
    timeZone: timezone,
  });
  return new Date(dateStr + 'T00:00:00Z');
}

describe('AttendanceService', () => {
  let service: AttendanceService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockEventEmitter = { emit: jest.fn() };

  const mockNotificationsService = {
    create: jest.fn().mockResolvedValue({}),
  };

  const today = getToday('Africa/Nairobi');
  const currentMonday = getMondayOfWeek(today);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: NotificationsService, useValue: mockNotificationsService },
        {
          provide: GymSettingsService,
          useValue: {
            getCachedSettings: jest
              .fn()
              .mockResolvedValue({ timezone: 'Africa/Nairobi' }),
          },
        },
      ],
    }).compile();
    service = module.get<AttendanceService>(AttendanceService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    // Make $transaction execute the callback with the same prisma mock
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
  });

  it('should reject invalid QR code', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue(null);
    await expect(
      service.checkIn('member-1', { qrCode: 'invalid' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject member without active subscription', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    prisma.subscriptionMember.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'John',
      lastName: 'Doe',
      displayPicture: null,
    } as any);
    await expect(
      service.checkIn('member-1', { qrCode: 'valid' }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('check_in.result', {
      type: 'check_in_result',
      member: {
        id: 'member-1',
        firstName: 'John',
        lastName: 'Doe',
        displayPicture: null,
      },
      success: false,
      message: 'No active subscription',
      entranceId: undefined,
      timestamp: expect.any(String),
    });
  });

  it('should emit check_in.result on successful check-in', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
      subscriptionId: 'sub-1',
      subscription: { plan: { isOffPeak: false } },
    } as any);
    prisma.attendance.findUnique.mockResolvedValue(null);
    prisma.attendance.create.mockResolvedValue({} as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: 'https://example.com/pic.jpg',
    } as any);
    prisma.streak.findUnique.mockResolvedValue(null);
    prisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 0,
      daysThisWeek: 1,
      bestWeek: 1,
      weekStart: currentMonday,
    } as any);
    prisma.attendance.count.mockResolvedValue(1);

    const result = await service.checkIn('member-1', { qrCode: 'valid' });

    expect(result.alreadyCheckedIn).toBe(false);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('check_in.result', {
      type: 'check_in_result',
      member: {
        id: 'member-1',
        firstName: 'Jane',
        lastName: 'Smith',
        displayPicture: 'https://example.com/pic.jpg',
      },
      success: true,
      message: 'Check-in successful',
      entranceId: undefined,
      timestamp: expect.any(String),
    });
  });

  it('should emit check_in.result with "Already checked in today" on re-scan', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
      subscriptionId: 'sub-1',
      subscription: { plan: { isOffPeak: false } },
    } as any);
    prisma.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      memberId: 'member-1',
    } as any);
    prisma.streak.findUnique.mockResolvedValue({
      memberId: 'member-1',
      weeklyStreak: 5,
      daysThisWeek: 3,
      weekStart: currentMonday,
    } as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: null,
    } as any);

    const result = await service.checkIn('member-1', { qrCode: 'valid' });

    expect(result.alreadyCheckedIn).toBe(true);
    expect(result.weeklyStreak).toBe(5);
    expect(result.daysThisWeek).toBe(3);
    expect(result.daysRequired).toBe(4);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('check_in.result', {
      type: 'check_in_result',
      member: {
        id: 'member-1',
        firstName: 'Jane',
        lastName: 'Smith',
        displayPicture: null,
      },
      success: true,
      message: 'Already checked in today',
      entranceId: undefined,
      timestamp: expect.any(String),
    });
  });

  it('should parse entranceId from QR payload and save on attendance', async () => {
    const entranceId = '550e8400-e29b-41d4-a716-446655440000';
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    prisma.entrance.findUnique.mockResolvedValue({
      id: entranceId,
      name: 'Front Door',
      isActive: true,
    } as any);
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
      subscriptionId: 'sub-1',
      subscription: { plan: { isOffPeak: false } },
    } as any);
    prisma.attendance.findUnique.mockResolvedValue(null);
    prisma.attendance.create.mockResolvedValue({} as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: null,
    } as any);
    prisma.streak.findUnique.mockResolvedValue(null);
    prisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 0,
      daysThisWeek: 1,
      bestWeek: 1,
      weekStart: currentMonday,
    } as any);
    prisma.attendance.count.mockResolvedValue(1);

    await service.checkIn('member-1', { qrCode: `valid:${entranceId}` });

    expect(prisma.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entranceId }),
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'check_in.result',
      expect.objectContaining({ entranceId }),
    );
  });

  it('should reject check-in with inactive entrance', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    const inactiveEntranceId = '550e8400-e29b-41d4-a716-446655440001';
    prisma.entrance.findUnique.mockResolvedValue({
      id: inactiveEntranceId,
      name: 'Closed Gate',
      isActive: false,
    } as any);

    await expect(
      service.checkIn('member-1', { qrCode: `valid:${inactiveEntranceId}` }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject check-in with non-existent entrance', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    const missingEntranceId = '550e8400-e29b-41d4-a716-446655440002';
    prisma.entrance.findUnique.mockResolvedValue(null);

    await expect(
      service.checkIn('member-1', { qrCode: `valid:${missingEntranceId}` }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should work without entranceId for backwards compatibility', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
      subscriptionId: 'sub-1',
      subscription: { plan: { isOffPeak: false } },
    } as any);
    prisma.attendance.findUnique.mockResolvedValue(null);
    prisma.attendance.create.mockResolvedValue({} as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: null,
    } as any);
    prisma.streak.findUnique.mockResolvedValue(null);
    prisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 0,
      daysThisWeek: 1,
      bestWeek: 1,
      weekStart: currentMonday,
    } as any);
    prisma.attendance.count.mockResolvedValue(1);

    await service.checkIn('member-1', { qrCode: 'valid' });

    expect(prisma.entrance.findUnique).not.toHaveBeenCalled();
    expect(prisma.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entranceId: undefined }),
    });
  });

  it('should reject off-peak member checking in during peak hours', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
      subscriptionId: 'sub-1',
      subscription: { plan: { isOffPeak: true } },
    } as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'John',
      lastName: 'Doe',
      displayPicture: null,
    } as any);

    const mockGymSettingsService = {
      getCachedSettings: jest.fn().mockResolvedValue({
        timezone: 'Africa/Nairobi',
        offPeakWindows: [
          { dayOfWeek: null, startTime: '06:00', endTime: '10:00' },
        ],
      }),
    };
    (service as any).gymSettingsService = mockGymSettingsService;

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-15T11:00:00Z')); // 14:00 EAT (peak)

    await expect(
      service.checkIn('member-1', { qrCode: 'valid' }),
    ).rejects.toThrow(BadRequestException);

    jest.useRealTimers();
  });

  it('should allow off-peak member checking in during off-peak hours', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    } as any);
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
      subscriptionId: 'sub-1',
      subscription: { plan: { isOffPeak: true } },
    } as any);

    const mockGymSettingsService = {
      getCachedSettings: jest.fn().mockResolvedValue({
        timezone: 'Africa/Nairobi',
        offPeakWindows: [
          { dayOfWeek: null, startTime: '06:00', endTime: '10:00' },
        ],
      }),
    };
    (service as any).gymSettingsService = mockGymSettingsService;

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-15T05:00:00Z')); // 08:00 EAT (off-peak)

    prisma.attendance.findUnique.mockResolvedValue(null);
    prisma.attendance.create.mockResolvedValue({} as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: null,
    } as any);
    prisma.streak.findUnique.mockResolvedValue(null);
    prisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 0,
      daysThisWeek: 1,
      bestWeek: 1,
      weekStart: new Date(),
    } as any);
    prisma.attendance.count.mockResolvedValue(1);

    const result = await service.checkIn('member-1', { qrCode: 'valid' });
    expect(result.alreadyCheckedIn).toBe(false);

    jest.useRealTimers();
  });

  it('should emit streak.updated event on successful check-in', async () => {
    prisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
      isActive: true,
      expiresAt: null,
      createdAt: new Date(),
    });
    prisma.subscriptionMember.findFirst.mockResolvedValue({
      memberId: 'member-1',
      subscription: {
        status: 'ACTIVE',
        endDate: new Date(Date.now() + 86400000),
        plan: { isOffPeak: false },
      },
    } as any);
    prisma.attendance.findUnique.mockResolvedValue(null);
    prisma.attendance.create.mockResolvedValue({} as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'John',
      lastName: 'Doe',
      displayPicture: null,
    } as any);
    prisma.streak.findUnique.mockResolvedValue(null);
    prisma.streak.upsert.mockResolvedValue({
      id: 's1',
      memberId: 'member-1',
      weeklyStreak: 0,
      longestStreak: 0,
      daysThisWeek: 1,
      bestWeek: 1,
      weekStart: currentMonday,
      lastCheckInDate: today,
    } as any);
    prisma.attendance.count.mockResolvedValue(1);

    await service.checkIn('member-1', { qrCode: 'valid' });

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'streak.updated',
      expect.objectContaining({
        memberId: 'member-1',
        isFirstCheckIn: true,
        totalCheckIns: 1,
      }),
    );
  });

  describe('weekly streak logic', () => {
    /** Helper: set up mocks so checkIn reaches updateStreak. */
    function setupCheckInMocks() {
      prisma.gymQrCode.findFirst.mockResolvedValue({
        id: '1',
        code: 'valid',
      } as any);
      prisma.subscriptionMember.findFirst.mockResolvedValue({
        id: 'sm-1',
        memberId: 'member-1',
        subscriptionId: 'sub-1',
        subscription: { plan: { isOffPeak: false } },
      } as any);
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.attendance.create.mockResolvedValue({} as any);
      prisma.user.findUnique.mockResolvedValue({
        id: 'member-1',
        firstName: 'Jane',
        lastName: 'Smith',
        displayPicture: null,
      } as any);
    }

    it('should increment daysThisWeek for same-week check-in', async () => {
      setupCheckInMocks();
      prisma.streak.findUnique.mockResolvedValue({
        memberId: 'member-1',
        weeklyStreak: 3,
        longestStreak: 5,
        daysThisWeek: 2,
        weekStart: currentMonday,
        lastCheckInDate: today,
      } as any);
      prisma.streak.upsert.mockResolvedValue({
        weeklyStreak: 3,
        longestStreak: 5,
        daysThisWeek: 3,
        bestWeek: 3,
        weekStart: currentMonday,
      } as any);
      prisma.attendance.count.mockResolvedValue(10);

      const result = await service.checkIn('member-1', { qrCode: 'valid' });

      expect(prisma.streak.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ daysThisWeek: 3, weeklyStreak: 3 }),
        }),
      );
      expect(result.daysThisWeek).toBe(3);
      expect(result.weeklyStreak).toBe(3);
    });

    it('should increment weeklyStreak when previous week had 4+ days', async () => {
      setupCheckInMocks();
      const prevMonday = new Date(currentMonday);
      prevMonday.setDate(prevMonday.getDate() - 7);

      prisma.streak.findUnique.mockResolvedValue({
        memberId: 'member-1',
        weeklyStreak: 2,
        longestStreak: 5,
        daysThisWeek: 4,
        weekStart: prevMonday,
        lastCheckInDate: prevMonday,
      } as any);
      prisma.streak.upsert.mockResolvedValue({
        weeklyStreak: 3,
        longestStreak: 5,
        daysThisWeek: 1,
        bestWeek: 4,
        weekStart: currentMonday,
      } as any);
      prisma.attendance.count.mockResolvedValue(15);

      const result = await service.checkIn('member-1', { qrCode: 'valid' });

      expect(prisma.streak.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ weeklyStreak: 3, daysThisWeek: 1 }),
        }),
      );
      expect(result.weeklyStreak).toBe(3);
    });

    it('should reset weeklyStreak when previous week had <4 days', async () => {
      setupCheckInMocks();
      const prevMonday = new Date(currentMonday);
      prevMonday.setDate(prevMonday.getDate() - 7);

      prisma.streak.findUnique.mockResolvedValue({
        memberId: 'member-1',
        weeklyStreak: 5,
        longestStreak: 5,
        daysThisWeek: 3,
        weekStart: prevMonday,
        lastCheckInDate: prevMonday,
      } as any);
      prisma.streak.upsert.mockResolvedValue({
        weeklyStreak: 0,
        longestStreak: 5,
        daysThisWeek: 1,
        bestWeek: 3,
        weekStart: currentMonday,
      } as any);
      prisma.attendance.count.mockResolvedValue(20);

      const result = await service.checkIn('member-1', { qrCode: 'valid' });

      expect(prisma.streak.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ weeklyStreak: 0, daysThisWeek: 1 }),
        }),
      );
      expect(result.weeklyStreak).toBe(0);
    });

    it('should reset weeklyStreak when weeks are skipped', async () => {
      setupCheckInMocks();
      const twoWeeksAgo = new Date(currentMonday);
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      prisma.streak.findUnique.mockResolvedValue({
        memberId: 'member-1',
        weeklyStreak: 8,
        longestStreak: 8,
        daysThisWeek: 5,
        weekStart: twoWeeksAgo,
        lastCheckInDate: twoWeeksAgo,
      } as any);
      prisma.streak.upsert.mockResolvedValue({
        weeklyStreak: 0,
        longestStreak: 8,
        daysThisWeek: 1,
        bestWeek: 5,
        weekStart: currentMonday,
      } as any);
      prisma.attendance.count.mockResolvedValue(30);

      const result = await service.checkIn('member-1', { qrCode: 'valid' });

      expect(prisma.streak.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ weeklyStreak: 0, daysThisWeek: 1 }),
        }),
      );
      expect(result.weeklyStreak).toBe(0);
      expect(result.longestStreak).toBe(8);
    });
  });

  describe('getStreak', () => {
    it('should return streak record when it exists', async () => {
      const streakRecord = {
        id: 's1',
        memberId: 'member-1',
        weeklyStreak: 3,
        longestStreak: 5,
        daysThisWeek: 2,
        bestWeek: 4,
        weekStart: currentMonday,
        lastCheckInDate: today,
      };
      prisma.streak.findUnique.mockResolvedValue(streakRecord as any);

      const result = await service.getStreak('member-1');

      expect(result).toEqual(streakRecord);
    });

    it('should return default fields when no streak exists', async () => {
      prisma.streak.findUnique.mockResolvedValue(null);

      const result = await service.getStreak('member-1');

      expect(result).toEqual({
        memberId: 'member-1',
        weeklyStreak: 0,
        longestStreak: 0,
        daysThisWeek: 0,
        bestWeek: 0,
        weekStart: null,
        lastCheckInDate: null,
      });
    });
  });
});
