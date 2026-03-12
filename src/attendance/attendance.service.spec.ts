/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

/** Return Monday 00:00 for the week containing `date`. */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

describe('AttendanceService', () => {
  let service: AttendanceService;

  const mockPrisma = {
    gymQrCode: { findFirst: jest.fn() },
    subscriptionMember: { findFirst: jest.fn() },
    attendance: { findUnique: jest.fn(), create: jest.fn() },
    streak: { upsert: jest.fn(), findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    entrance: { findUnique: jest.fn() },
  };

  const mockEventEmitter = { emit: jest.fn() };

  const mockNotificationsService = {
    create: jest.fn().mockResolvedValue({}),
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonday = getMondayOfWeek(today);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();
    service = module.get<AttendanceService>(AttendanceService);
    jest.clearAllMocks();
  });

  it('should reject invalid QR code', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue(null);
    await expect(
      service.checkIn('member-1', { qrCode: 'invalid' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject member without active subscription', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'John',
      lastName: 'Doe',
      displayPicture: null,
    });
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
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
    });
    mockPrisma.attendance.findUnique.mockResolvedValue(null);
    mockPrisma.attendance.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: 'https://example.com/pic.jpg',
    });
    mockPrisma.streak.findUnique.mockResolvedValue(null);
    mockPrisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 0,
      daysThisWeek: 1,
      weekStart: currentMonday,
    });

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
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
    });
    mockPrisma.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      memberId: 'member-1',
    });
    mockPrisma.streak.findUnique.mockResolvedValue({
      memberId: 'member-1',
      weeklyStreak: 5,
      daysThisWeek: 3,
      weekStart: currentMonday,
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: null,
    });

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
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    });
    mockPrisma.entrance.findUnique.mockResolvedValue({
      id: entranceId,
      name: 'Front Door',
      isActive: true,
    });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
    });
    mockPrisma.attendance.findUnique.mockResolvedValue(null);
    mockPrisma.attendance.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: null,
    });
    mockPrisma.streak.findUnique.mockResolvedValue(null);
    mockPrisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 0,
      daysThisWeek: 1,
      weekStart: currentMonday,
    });

    await service.checkIn('member-1', { qrCode: `valid:${entranceId}` });

    expect(mockPrisma.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entranceId }),
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'check_in.result',
      expect.objectContaining({ entranceId }),
    );
  });

  it('should reject check-in with inactive entrance', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    });
    const inactiveEntranceId = '550e8400-e29b-41d4-a716-446655440001';
    mockPrisma.entrance.findUnique.mockResolvedValue({
      id: inactiveEntranceId,
      name: 'Closed Gate',
      isActive: false,
    });

    await expect(
      service.checkIn('member-1', { qrCode: `valid:${inactiveEntranceId}` }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject check-in with non-existent entrance', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    });
    const missingEntranceId = '550e8400-e29b-41d4-a716-446655440002';
    mockPrisma.entrance.findUnique.mockResolvedValue(null);

    await expect(
      service.checkIn('member-1', { qrCode: `valid:${missingEntranceId}` }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should work without entranceId for backwards compatibility', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    });
    mockPrisma.subscriptionMember.findFirst.mockResolvedValue({
      id: 'sm-1',
      memberId: 'member-1',
    });
    mockPrisma.attendance.findUnique.mockResolvedValue(null);
    mockPrisma.attendance.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: null,
    });
    mockPrisma.streak.findUnique.mockResolvedValue(null);
    mockPrisma.streak.upsert.mockResolvedValue({
      weeklyStreak: 0,
      longestStreak: 0,
      daysThisWeek: 1,
      weekStart: currentMonday,
    });

    await service.checkIn('member-1', { qrCode: 'valid' });

    expect(mockPrisma.entrance.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entranceId: undefined }),
    });
  });

  describe('weekly streak logic', () => {
    /** Helper: set up mocks so checkIn reaches updateStreak. */
    function setupCheckInMocks() {
      mockPrisma.gymQrCode.findFirst.mockResolvedValue({
        id: '1',
        code: 'valid',
      });
      mockPrisma.subscriptionMember.findFirst.mockResolvedValue({
        id: 'sm-1',
        memberId: 'member-1',
      });
      mockPrisma.attendance.findUnique.mockResolvedValue(null);
      mockPrisma.attendance.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'member-1',
        firstName: 'Jane',
        lastName: 'Smith',
        displayPicture: null,
      });
    }

    it('should increment daysThisWeek for same-week check-in', async () => {
      setupCheckInMocks();
      mockPrisma.streak.findUnique.mockResolvedValue({
        memberId: 'member-1',
        weeklyStreak: 3,
        longestStreak: 5,
        daysThisWeek: 2,
        weekStart: currentMonday,
        lastCheckInDate: today,
      });
      mockPrisma.streak.upsert.mockResolvedValue({
        weeklyStreak: 3,
        longestStreak: 5,
        daysThisWeek: 3,
        weekStart: currentMonday,
      });

      const result = await service.checkIn('member-1', { qrCode: 'valid' });

      expect(mockPrisma.streak.upsert).toHaveBeenCalledWith(
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

      mockPrisma.streak.findUnique.mockResolvedValue({
        memberId: 'member-1',
        weeklyStreak: 2,
        longestStreak: 5,
        daysThisWeek: 4,
        weekStart: prevMonday,
        lastCheckInDate: prevMonday,
      });
      mockPrisma.streak.upsert.mockResolvedValue({
        weeklyStreak: 3,
        longestStreak: 5,
        daysThisWeek: 1,
        weekStart: currentMonday,
      });

      const result = await service.checkIn('member-1', { qrCode: 'valid' });

      expect(mockPrisma.streak.upsert).toHaveBeenCalledWith(
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

      mockPrisma.streak.findUnique.mockResolvedValue({
        memberId: 'member-1',
        weeklyStreak: 5,
        longestStreak: 5,
        daysThisWeek: 3,
        weekStart: prevMonday,
        lastCheckInDate: prevMonday,
      });
      mockPrisma.streak.upsert.mockResolvedValue({
        weeklyStreak: 0,
        longestStreak: 5,
        daysThisWeek: 1,
        weekStart: currentMonday,
      });

      const result = await service.checkIn('member-1', { qrCode: 'valid' });

      expect(mockPrisma.streak.upsert).toHaveBeenCalledWith(
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

      mockPrisma.streak.findUnique.mockResolvedValue({
        memberId: 'member-1',
        weeklyStreak: 8,
        longestStreak: 8,
        daysThisWeek: 5,
        weekStart: twoWeeksAgo,
        lastCheckInDate: twoWeeksAgo,
      });
      mockPrisma.streak.upsert.mockResolvedValue({
        weeklyStreak: 0,
        longestStreak: 8,
        daysThisWeek: 1,
        weekStart: currentMonday,
      });

      const result = await service.checkIn('member-1', { qrCode: 'valid' });

      expect(mockPrisma.streak.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ weeklyStreak: 0, daysThisWeek: 1 }),
        }),
      );
      expect(result.weeklyStreak).toBe(0);
      expect(result.longestStreak).toBe(8);
    });
  });
});
