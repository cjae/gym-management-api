import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('AttendanceService', () => {
  let service: AttendanceService;

  const mockPrisma = {
    gymQrCode: { findFirst: jest.fn() },
    subscriptionMember: { findFirst: jest.fn() },
    attendance: { findUnique: jest.fn(), create: jest.fn() },
    streak: { upsert: jest.fn(), findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const mockEventEmitter = { emit: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
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
      currentStreak: 1,
      longestStreak: 1,
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
      currentStreak: 5,
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'member-1',
      firstName: 'Jane',
      lastName: 'Smith',
      displayPicture: null,
    });

    const result = await service.checkIn('member-1', { qrCode: 'valid' });

    expect(result.alreadyCheckedIn).toBe(true);
    expect(result.streak).toBe(5);
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
      timestamp: expect.any(String),
    });
  });
});
