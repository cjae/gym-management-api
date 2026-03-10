/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
    entrance: { findUnique: jest.fn() },
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
      entranceId: undefined,
      timestamp: expect.any(String),
    });
  });

  it('should parse entranceId from QR payload and save on attendance', async () => {
    const entranceId = 'entrance-1';
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
      currentStreak: 1,
      longestStreak: 1,
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
    mockPrisma.entrance.findUnique.mockResolvedValue({
      id: 'e-1',
      name: 'Closed Gate',
      isActive: false,
    });

    await expect(
      service.checkIn('member-1', { qrCode: 'valid:e-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject check-in with non-existent entrance', async () => {
    mockPrisma.gymQrCode.findFirst.mockResolvedValue({
      id: '1',
      code: 'valid',
    });
    mockPrisma.entrance.findUnique.mockResolvedValue(null);

    await expect(
      service.checkIn('member-1', { qrCode: 'valid:missing-id' }),
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
      currentStreak: 1,
      longestStreak: 1,
    });

    await service.checkIn('member-1', { qrCode: 'valid' });

    expect(mockPrisma.entrance.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entranceId: undefined }),
    });
  });
});
